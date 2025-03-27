const { Sequelize } = require('sequelize');
const fetch = require('node-fetch'); // Adicione essa dependência no seu projeto, se necessário
require('dotenv').config(); // Carrega variáveis do .env

// Função para validar CPF/CNPJ
const isValidCpfCnpj = (value) => {
    const cleanedValue = value.replace(/\D/g, ''); // Remove caracteres não numéricos

    return cleanedValue.length === 11 ? validateCpf(cleanedValue) 
         : cleanedValue.length === 14 ? validateCnpj(cleanedValue) 
         : false;
};

// Validação de CPF
const validateCpf = (cpf) => {
    if (/^(\d)\1{10}$/.test(cpf)) return false; // Evita sequência de números repetidos

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

// Função para formatar CPF/CNPJ
const formatCpfCnpj = (value) => {
    const cleanedValue = value.replace(/\D/g, '');
    return cleanedValue.length <= 11
        ? cleanedValue.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
        : cleanedValue.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
};

// Função para validar CPF/CNPJ e buscar chave NFe
const validaCpfCnpj = async (cpf_cnpj, sequelize, contactId) => {
    if (!isValidCpfCnpj(cpf_cnpj)) {
        return { flag: 'cpf_invalid', message: 'CPF/CNPJ inválido' };
    }

    const formattedCpfCnpj = formatCpfCnpj(cpf_cnpj);

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
    if(result.length){
        enviaRastreio(cpf_cnpj, sequelize, contactId)
        return{ flag: 'rastreio_encontrado', message: 'CPF/CNPJ válido e encontrado' }

    }else{
         return  { flag: 'registro_nao_encontrado', message: 'Nenhum registro encontrado' };
    }
};

// Função para enviar rastreamento
const enviaRastreio = async (cpf_cnpj, sequelize, contactId) => {
    if (!isValidCpfCnpj(cpf_cnpj)) {
        return { flag: 'cpf_invalid', message: 'CPF/CNPJ inválido' };
    }

    const formattedCpfCnpj = formatCpfCnpj(cpf_cnpj);

    // Busca o código de rastreamento
    const result = await sequelize.query(
        `SELECT ns.intelipost_order
        FROM nota_saida ns
        JOIN cliente c ON c.id_cliente = ns.id_cliente
        WHERE c.cpf = :cpf_cnpj OR c.cnpj = :cpf_cnpj or ns.marketplace_pedido = :cpf_cnpj
        limit 1`,
        {
            type: Sequelize.QueryTypes.SELECT,
            replacements: { cpf_cnpj: formattedCpfCnpj }
        }
    );

    if (!result.length || !result[0].intelipost_order) {
        return { flag: 'registro_nao_encontrado', message: 'Nenhum código de rastreamento encontrado' };
    }

    const intelipostOrder = result[0].intelipost_order;
    const rastreioUrl = `https://fidcomex.up.railway.app/rastreio/${intelipostOrder}`;

    msg = `
    Seu link de rastreio está aqui: 
    ${rastreioUrl}
    `
    enviaMensagem(msg, contactId)

    msg = `  
    Deseja Voltar ao menu inicial?
    1 - Sim
    2 - Não`
    enviaMensagem(msg, contactId)

};

const validaPedido = async (pedido, sequelize, contactId) => {

    // Busca o código de rastreamento
    const result = await sequelize.query(
        `SELECT ns.intelipost_order
        FROM nota_saida ns
        JOIN cliente c ON c.id_cliente = ns.id_cliente
        WHERE ns.marketplace_pedido = :pedido
        limit 1`,
        {
            type: Sequelize.QueryTypes.SELECT,
            replacements: { pedido: pedido }
        }
    );

    if (!result.length || !result[0].intelipost_order) {
        return { flag: 'pedido_nao_encontrado', message: 'Nenhum pedido encontrado' };
    }


    enviaMensagem()

}

const enviaMensagem = async (msg, contactId) =>{
    const requestBody = {
        text: msg,
        type: "chat",
        contactId : contactId,
        userId: '3af46a66-9ace-436f-b1c9-5b7753f74188',
        origin: "bot"
    };
    console.log('body : ',requestBody)
    try {
        const response = await fetch('https://fidcomex.digisac.co/api/v1/messages', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer 990a07db6cc8c28c2a5547fd72ae4a665a1258d2`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        console.log(response)
        if (!response.ok) {
            throw new Error(`Erro ao enviar rastreamento: ${response.statusText}`);
        }

        return { flag: 'sucesso', message: 'Rastreamento enviado com sucesso' };
    } catch (error) {
        return { flag: 'erro', message: error.message };
    }
}

module.exports = { validaCpfCnpj, enviaRastreio, validaPedido, enviaMensagem };
