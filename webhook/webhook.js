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

// Valida CPF/CNPJ no banco
const valida = async (cpf_cnpj, sequelize) => {
    const formattedCpfCnpj = formatCpfCnpj(cpf_cnpj);

    if (!isValidCpfCnpj(cpf_cnpj)) {
        return { flag: 'cpf_invalid', message: 'CPF/CNPJ inválido' };
    }

    const result = await sequelize.query(
        `SELECT ns.chavenfe
        FROM nota_saida ns
        JOIN cliente c ON c.id_cliente = ns.id_cliente
        WHERE c.cpf = :cpf_cnpj OR c.cnpj = :cpf_cnpj`,
        {
            type: Sequelize.QueryTypes.SELECT,
            replacements: { cpf_cnpj: formattedCpfCnpj }
        }
    );

    return result;
};

// Envia NFE
const enviaNFE = async (cpf_cnpj, sequelize, contactId) => {
    const result = await valida(cpf_cnpj, sequelize);

    if (result === "cpf_invalid") {
        return { flag: "cpf_invalid", message: "CPF/CNPJ inválido" };
    }

    if (!result.length) {
        return { flag: 'registro_nao_encontrado', message: 'Nenhum registro encontrado' };
    }

    const chaveNfe = result[0].chavenfe;
    const msg = `Para acessar sua NFE, acesse: 
https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=7PhJ+gAVw2g=  
e insira a seguinte chave :`;

    await enviaMensagem(msg, contactId);
    await enviaMensagem(chaveNfe, contactId);

    setTimeout(() => enviaMensagem("Para encerrar, digite *fim*", contactId), 1000);

    return { flag: 'nfe_enviada', message: 'CPF/CNPJ válido e encontrado' };
};


const validaCpfCnpj = async (cpf_cnpj, sequelize, contactId) => {
    const result = await valida(cpf_cnpj, sequelize, contactId); // Aguarda a validação

    if (result === "cpf_invalid") {
        return { flag: "cpf_invalid", message: "CPF/CNPJ inválido" };
    }
    
    if (!result.length) {
        return { flag: 'registro_nao_encontrado', message: 'Nenhum registro encontrado' };
    }


    const formattedCpfCnpj = formatCpfCnpj(cpf_cnpj);
    await enviaRastreio(formattedCpfCnpj, sequelize, contactId); // Aguarda o envio do rastreio

    return { flag: 'rastreio_encontrado', message: 'CPF/CNPJ válido e encontrado' };
};


// Envia rastreamento
const enviaRastreio = async (cpf_cnpj, sequelize, contactId) => {
    const result = await sequelize.query(
        `SELECT ns.intelipost_order, 
        CASE 
            WHEN ns.parceiro = 'FIDCOMERCIOEXTERIOREIRELI' THEN 'Mercado Livre' 
            WHEN ns.parceiro LIKE '%WAPSTORE%' THEN 'Site Fid Comex' 
            ELSE ns.parceiro 
        END AS portal, 
        ns.marketplace_pedido as pedido
        FROM nota_saida ns
        JOIN cliente c ON c.id_cliente = ns.id_cliente
        WHERE c.cpf = :cpf_cnpj OR c.cnpj = :cpf_cnpj OR ns.marketplace_pedido = :cpf_cnpj
        LIMIT 1`,
        {
            type: Sequelize.QueryTypes.SELECT,
            replacements: { cpf_cnpj }
        }
    );

    if (!result.length || !result[0].intelipost_order) {
        return { flag: 'registro_nao_encontrado', message: 'Nenhum código de rastreamento encontrado' };
    }

    const { intelipost_order, portal, pedido } = result[0];
    const rastreioUrl = `https://fidcomex.up.railway.app/rastreio/${intelipost_order}`;

    const msg = `Encontramos seu pedido do *${portal}*\nPedido: ${pedido}\n\nO link de rastreamento é:\n${rastreioUrl}`;
    await enviaMensagem(msg, contactId);

    setTimeout(() => enviaMensagem("Para encerrar, digite *fim*", contactId), 1000);
};

// Valida pedido
const validaPedido = async (pedido, sequelize, contactId) => {
    const result = await sequelize.query(
        `SELECT ns.intelipost_order
        FROM nota_saida ns
        JOIN cliente c ON c.id_cliente = ns.id_cliente
        WHERE ns.marketplace_pedido = :pedido
        LIMIT 1`,
        {
            type: Sequelize.QueryTypes.SELECT,
            replacements: { pedido }
        }
    );

    if (!result.length || !result[0].intelipost_order) {
        return { flag: 'pedido_nao_encontrado', message: 'Nenhum pedido encontrado' };
    }

    await enviaMensagem(`Seu pedido foi encontrado! Código: ${result[0].intelipost_order}`, contactId);
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

module.exports = { validaCpfCnpj, enviaNFE, enviaRastreio, validaPedido, enviaMensagem };
