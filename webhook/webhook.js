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

const pesquisasSql = async(pesquisa, tipo, sequelize) => {
    let filtro = '';
    let replacements = { pesquisa };

    if (tipo === 'cpf_cnpj') {
        pesquisa = formatCpfCnpj(pesquisa);
        if (!isValidCpfCnpj(pesquisa)) return 'cpf_invalido';

        filtro = `AND (c.cpf = :pesquisa OR c.cnpj = :pesquisa OR c.marketplace_pedido = :pesquisa)`;
    }

    if (tipo === 'pedido')  filtro = `AND ns.marketplace_pedido = :pesquisa`;
    
    if (tipo === 'email')  filtro = `AND c.email = :pesquisa`;
    
    const result = await sequelize.query(
        `SELECT ns.chavenfe,
                ns.marketplace_pedido as pedido,
                c.email,
                c.razsocial, 
                ns.intelipost_order,
                CASE 
                    WHEN ns.parceiro = 'FIDCOMERCIOEXTERIOREIRELI' THEN 'Mercado Livre' 
                    WHEN ns.parceiro LIKE '%WAPSTORE%' THEN 'Site Fid ComeX' 
                    ELSE ns.parceiro 
                END AS portal
        FROM nota_saida ns
        JOIN cliente c ON c.id_cliente = ns.id_cliente
        WHERE ns.chavenfe <> ''
        ${filtro}`,
        {
            type: sequelize.QueryTypes.SELECT,
            replacements: replacements
        }
    );

    return result;
}


const validaCpfParaTroca = async (cpf_cnpj, sequelize, contactId) => {
    const result = await pesquisasSql(cpf_cnpj, 'cpf_cnpj', sequelize);

    if (result === "cpf_invalido") return { flag: "cpf_invalido", message: "CPF/CNPJ inválido" };
    
    if (!result.length) return { flag: 'registro_nao_encontrado_troca', message: 'Nenhum registro encontrado' };
    

    return await processaValidacaoTroca(result, contactId);
};


const validaPedidoParaTroca = async (pedido, sequelize, contactId) => {

    const result=  await pesquisasSql(pedido, 'pedido', sequelize);

    if (!result.length) {
        
        if (pedido.startsWith('20000')) return { flag: 'registro_nao_encontrado_meli', message: 'Nenhum registro encontrado' };

        return { flag: 'registro_nao_encontrado', message: 'Nenhum registro encontrado' };
    }

    return await processaValidacaoTroca(result, contactId);
};


const processaValidacaoTroca = async (result, contactId) => {
    
    const { pedido, email, razsocial: nome, portal } = result[0];

    let msg = ` ${nome}, encontramos seu pedido\n Pedido : *${pedido}*\n Email : ${email}`;

    await enviaMensagem(msg, contactId);

    msg = `Aguarde um momento iremos te transferir para um dos nossos atendentes.`;
    await enviaMensagem(msg, contactId);

    const flag = (portal === 'Mercado Livre' || pedido.startsWith('20000')) 
    ? 'encaminha_troca_meli' 
    : 'encaminha_troca_sac';


    return { flag, message: 'Encontrado' };
};


const enviaNFE = async (sequelize, contactId, result) => {
  
    const chaveNfe = result[0].chavenfe;
    const msg = `Para acessar sua NFE, acesse: \n https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=7PhJ+gAVw2g= \ne insira a seguinte chave :`;

    await enviaMensagem(msg, contactId);
    await enviaMensagem(chaveNfe, contactId);

    setTimeout(() => enviaMensagem("Para encerrar, digite *fim*", contactId), 1000);

    return { flag: 'nfe_enviada', message: 'Nfe encontrada' };
};

const enviaNFEPeloPedido = async (pedido, sequelize, contactId) => {

    const result = await pesquisasSql(pedido, 'pedido', sequelize);

    if (!result.length) {
        const flag = pedido.startsWith('20000') 
            ? 'registro_nao_encontrado_meli' 
            : 'registro_nao_encontrado';
        return { flag, message: 'Nenhum registro encontrado' };
    }

    return enviaNFE(sequelize, contactId, result);
};


// Envia NFE pelo CPF/CNPJ
const enviaNFEPleoCpf = async (cpf_cnpj, sequelize, contactId) => {
    const result = await pesquisasSql(cpf_cnpj, 'cpf_cnpj', sequelize)
    
    if (result === "cpf_invalido") return { flag: "cpf_invalido", message: "CPF/CNPJ inválido" };

    if (!result.length) return { flag: 'registro_nao_encontrado', message: 'Nenhum registro encontrado' };

    return enviaNFE(sequelize, contactId, result);
};



const validaCpfCnpj = async (cpf_cnpj, sequelize, contactId) => {

    const result = await pesquisasSql(cpf_cnpj, 'cpf_cnpj', sequelize)

    if (result === "cpf_invalido") return { flag: "cpf_invalido", message: "CPF/CNPJ inválido" };
    
    if (!result.length)  return { flag: 'registro_nao_encontrado', message: 'Nenhum registro encontrado' };
    

    const formattedCpfCnpj = formatCpfCnpj(cpf_cnpj);
    await enviaRastreio(formattedCpfCnpj, sequelize, contactId); // Aguarda o envio do rastreio

    return { flag: 'rastreio_encontrado', message: 'CPF/CNPJ válido e encontrado' };
};


const enviaRastreio = async (cpf_cnpj, sequelize, contactId) => {

    const result = await pesquisasSql(cpf_cnpj, 'cpf_cnpj', sequelize);

    if (!result?.intelipost_order) {
        return { flag: 'registro_nao_encontrado', message: 'Nenhum código de rastreio encontrado' };
    }

    const { intelipost_order, portal, pedido } = result;
    const rastreioUrl = `https://fidcomex.up.railway.app/rastreio/${intelipost_order}`;
    const msg = `Encontramos seu pedido do *${portal}*\nPedido: ${pedido}\n\nO link de rastreio é:\n${rastreioUrl}`;

    await enviaMensagem(msg, contactId);
    setTimeout(() => enviaMensagem("Para encerrar, digite *fim*", contactId), 1000);

    return { flag: 'rastreio_enviado', message: 'Rastreio enviado' };
};


// Valida pedido
const validaPedido = async (pedido, sequelize, contactId) => {

    const result = await pesquisasSql(pedido, 'pedido', sequelize);

    if (!result.length || !result[0].intelipost_order) return { flag: 'pedido_nao_encontrado', message: 'Nenhum pedido encontrado' };

    await enviaMensagem(`Seu pedido foi encontrado! Código: ${result[0].intelipost_order}`, contactId);

    return { flag: 'pedido_encontrado', message: 'Encontrado' };

};


const validaEmailOutrosAssuntos = async (email, sequelize, contactId) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email || !emailRegex.test(email)) return { flag: 'email_invalido', message: 'Email inválido' };

    const result = await pesquisasSql(email, 'email', sequelize);
  
    if (result.length ) {
        const { intelipost_order, portal, pedido } = result[0];
        const rastreioUrl = `https://fidcomex.up.railway.app/rastreio/${intelipost_order}`;

        let msg = `Encontramos seu pedido do *${portal}*\nPedido: ${pedido}\n\nO link de rastreio é:\n${rastreioUrl}`;
        await enviaMensagem(msg, contactId);

        return { flag: 'email_encontrado', message: 'Nenhum pedido encontrado' };
    }
    
    await enviaMensagem('Por gentileza, informe o motivo do seu chamado.', contactId);

    return { flag: 'email_valido', message: 'Email válido' };
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
    validaCpfCnpj, 
    enviaRastreio, 
    validaPedido, 
    enviaMensagem,
    enviaNFEPleoCpf, 
    enviaNFEPeloPedido, 
    validaCpfParaTroca, 
    validaPedidoParaTroca, 
    validaEmailOutrosAssuntos 
};
