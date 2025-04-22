const { Sequelize } = require('sequelize');
const fetch = require('node-fetch');
require('dotenv').config();

// Função para validar CPF/CNPJ
const isValidCpfCnpj = (value) => {
    const cleanedValue = value.replace(/\D/g, '');
    return cleanedValue.length === 11 ? validateCpf(cleanedValue) 
         : cleanedValue.length === 14 ? validateCnpj(cleanedValue) 
         : false;
};

// Validação de CPF
const validateCpf = (cpf) => {
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    let sum = 0, rest;
    for (let i = 1; i <= 9; i++) sum += parseInt(cpf[i - 1]) * (11 - i);
    rest = (sum * 10) % 11;
    if (rest >= 10) rest = 0;
    if (rest !== parseInt(cpf[9])) return false;

    sum = 0;
    for (let i = 1; i <= 10; i++) sum += parseInt(cpf[i - 1]) * (12 - i);
    rest = (sum * 10) % 11;
    if (rest >= 10) rest = 0;
    return rest === parseInt(cpf[10]);
};

// Validação de CNPJ
const validateCnpj = (cnpj) => {
    if (/^(\d)\1{13}$/.test(cnpj)) return false;

    const calcDigit = (base) => {
        let sum = 0, pos = base.length - 7;
        for (let i = base.length; i >= 1; i--) {
            sum += base[base.length - i] * pos--;
            if (pos < 2) pos = 9;
        }
        return sum % 11 < 2 ? 0 : 11 - (sum % 11);
    };

    return calcDigit(cnpj.slice(0, 12)) === parseInt(cnpj[12]) &&
           calcDigit(cnpj.slice(0, 13)) === parseInt(cnpj[13]);
};

// Formatar CPF/CNPJ
const formatCpfCnpj = (value) => {
    const cleanedValue = value.replace(/\D/g, '');
    return cleanedValue.length <= 11
        ? cleanedValue.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
        : cleanedValue.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
};


const checkBusinessHours = async (contactId) => {
    const agora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const diaSemana = agora.getDay(); 
    const hora = agora.getHours();
    const minuto = agora.getMinutes();

    const foraDiaUtil = (diaSemana === 0 || diaSemana === 6);
    const antesDoInicio = hora < 8 || (hora === 8 && minuto < 30);
    const depoisDoFim = hora > 17 || (hora === 17 && minuto > 30);
    const foraHorario = antesDoInicio || depoisDoFim;


    if (foraDiaUtil || foraHorario) {
        msg = "Nosso atendimento funciona de segunda a sexta, das 08:30 às 17:30. Por favor, aguarde até o próximo horário de atendimento.";
    } else {
        msg = "Aguarde um momento, iremos te transferir para um dos nossos atendentes.";
    }

    await enviaMensagem(msg, contactId);
};


const pesquisasSql = async(pesquisa, tipo, sequelize) => {
    let filtro = '';
    let replacements = { pesquisa };

    if (tipo === 'cpf_cnpj') {

        pesquisa = formatCpfCnpj(pesquisa);
        if (!isValidCpfCnpj(pesquisa)) return 'cpf_invalido';
        replacements = {pesquisa}
        filtro = `AND (c.cpf = :pesquisa OR c.cnpj = :pesquisa)`;
    }

    if (tipo === 'pedido')  filtro = `AND ns.marketplace_pedido = :pesquisa`;
    
    if (tipo === 'email')  filtro = `AND c.email = :pesquisa`;

    
    const result = await sequelize.query(
        `WITH ultimos_eventos AS (
            SELECT 
                er1.id_nota_saida,
                er1.evento,
                er1.dthr_atualizacao,
                ROW_NUMBER() OVER (PARTITION BY er1.id_nota_saida ORDER BY er1.dthr_atualizacao DESC) AS rn
            FROM sysemp.entrega_rastreio er1
        )
        SELECT 
            ns.chavenfe,
            ns.marketplace_pedido AS pedido,
            c.email,
            c.razsocial, 
            ns.intelipost_order,
            CASE 
                WHEN ns.parceiro = 'FIDCOMERCIOEXTERIOREIRELI' THEN 'Mercado Livre' 
                WHEN ns.parceiro LIKE '%WAPSTORE%' THEN 'Site Fid ComeX' 
                ELSE ns.parceiro 
            END AS portal,
            er.evento,
            ns.transportadora_ecommerce 
        FROM sysemp.nota_saida ns
        JOIN sysemp.cliente c ON c.id_cliente = ns.id_cliente
        JOIN ultimos_eventos er ON er.id_nota_saida = ns.id_nota_saida AND er.rn = 1
        WHERE ns.transportadora_ecommerce <> 'ENVVIAS NOR'
        AND ns.chavenfe <> ''
        ${filtro}`,
        {
            type: sequelize.QueryTypes.SELECT,
            replacements
        }
    );  
    return result;
}


const validaParaTroca = async (valor, sequelize, contactId, type = 'cpf_cnpj') => {
    const result = await pesquisasSql(valor, type, sequelize);

    if (type === 'cpf_cnpj') {
        if (result === "cpf_invalido") {
            return { flag: "cpf_invalido", message: "CPF/CNPJ inválido" };
        }
    }

    if (!result.length) {
        if (type === 'pedido' && valor.startsWith('20000')) {
            return { flag: 'registro_nao_encontrado_meli', message: 'Nenhum registro encontrado' };
        }
        return { flag: 'registro_nao_encontrado', message: 'Nenhum registro encontrado' };
    }

    return await processaValidacaoTroca(result, contactId);
};


const processaValidacaoTroca = async (result, contactId) => {
    const { pedido, email, razsocial: nome, portal } = result[0];

    let msg = ` ${nome}, encontramos seu pedido\n Portal : *${portal}*\n Pedido : *${pedido}*`;
    if (email) {
        msg += `\n Email : ${email}`;
    }
    await enviaMensagem(msg, contactId);

    await checkBusinessHours(contactId)

    const flag = (portal === "Mercado Livre" || pedido.startsWith("20000")) 
        ? "encaminha_troca_meli" 
        : "encaminha_troca_sac";

    return { flag, message: "Encontrado" };
};


const enviaNFE = async (cpf_cnpj, sequelize, contactId, type = 'cpf_cnpj') => {
    const result = await pesquisasSql(cpf_cnpj, type, sequelize)
    
    if (result === "cpf_invalido") return { flag: "cpf_invalido", message: "CPF/CNPJ inválido" };

    if (!result.length) {
        const flag = cpf_cnpj.startsWith('20000') 
            ? 'registro_nao_encontrado_meli' 
            : 'registro_nao_encontrado';
        return { flag, message: 'Nenhum registro encontrado' };
    }

    const chaveNfe = result[0].chavenfe;
    const msg = `Para acessar sua NFE, acesse: \n https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=7PhJ+gAVw2g= \ne insira a seguinte chave :`;

    await enviaMensagem(msg, contactId);
    await enviaMensagem(chaveNfe, contactId);

    return { flag: 'nfe_enviada', message: 'Nfe encontrada' };
};


// Envia rastreio pelo cpf
const enviaRastreio = async (cpf_cnpj, sequelize, contactId, type = 'cpf_cnpj') => {

    const result = await pesquisasSql(cpf_cnpj, type, sequelize)

    if (result === "cpf_invalido") return { flag: "cpf_invalido", message: "CPF/CNPJ inválido" };
    if (!result.length)  return { flag: 'registro_nao_encontrado', message: 'Nenhum registro encontrado' };

    return await encontrou_pedido(result, contactId); // Aguarda o envio do rastreio

};


const encontrou_pedido = async (result, contactId) => {

    const { intelipost_order, portal, pedido, evento, transportadora_ecommerce  } = result[0];

    let rastreioUrl = `https://fidcomex.up.railway.app/rastreio/${intelipost_order}`;

    if( transportadora_ecommerce == 'ENVVIAS NOR'){
        rastreioUrl = 'https://vvlog.uxdelivery.com.br/tracking'
    }

    const msg = `Encontramos seu pedido do *${portal}*\nPedido: ${pedido}\nStatus Atual: ${evento} \n\nO link de rastreio é:\n${rastreioUrl}`;

    await enviaMensagem(msg, contactId);

    return { flag: 'rastreio_enviado', message: 'Rastreio enviado' };

}


const validaEmailOutrosAssuntos = async (cpf_cnpj, sequelize, contactId) => {
    const result = await pesquisasSql(cpf_cnpj, 'cpf_cnpj', sequelize);

    if (result === "cpf_invalido") return { flag: "cpf_invalido_outros_assuntos", message: "CPF/CNPJ inválido" };


    if (result.length ) {
        const { intelipost_order, portal, pedido, transportadora_ecommerce } = result[0];
        let rastreioUrl = `https://fidcomex.up.railway.app/rastreio/${intelipost_order}`;

        if( transportadora_ecommerce == 'ENVVIAS NOR'){
            rastreioUrl = 'https://vvlog.uxdelivery.com.br/tracking'
        }

        let msg = `Encontramos seu pedido do *${portal}*\nPedido: ${pedido}\n\nO link de rastreio é:\n${rastreioUrl}`;
        await enviaMensagem(msg, contactId);

        
        return { flag: 'cpf_encontrado_outros_assuntos', message: 'Pedido encontrado' };
    }
    
    await enviaMensagem('Por gentileza, informe o motivo do seu chamado.', contactId);

  

    return { flag: 'cpf_valido_outros_assuntos', message: 'cpf válido' };
};


// Envia mensagem
const enviaMensagem = async (msg, contactId) => {
    const requestBody = {
        text: msg,
        type: "chat",
        contactId,
        userId: '3af46a66-9ace-436f-b1c9-5b7753f74188',
        origin: "bot"
    };

    try {
        const response = await fetch('https://fidcomex.digisac.co/api/v1/messages', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer 990a07db6cc8c28c2a5547fd72ae4a665a1258d2`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) throw new Error(`Erro ao enviar mensagem: ${response.statusText}`);

        return { flag: 'sucesso', message: 'Mensagem enviada com sucesso' };
    } catch (error) {
        return { flag: 'erro', message: error.message };
    }
};

module.exports = { 
    enviaRastreio, 
    enviaMensagem,
    enviaNFE,
    validaParaTroca,
    validaEmailOutrosAssuntos 
};
