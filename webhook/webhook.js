const { Sequelize } = require('sequelize');

const isValidCpfCnpj = (value) => {
    value = value.replace(/\D/g, ''); // Remove caracteres não numéricos

    if (value.length === 11) {
        return validateCpf(value);
    } else if (value.length === 14) {
        return validateCnpj(value);
    }
    return false;
};

const validateCpf = (cpf) => {
    if (/^(\d)\1{10}$/.test(cpf)) return false; // Verifica sequência de números repetidos

    let sum = 0, rest;
    for (let i = 1; i <= 9; i++) sum += parseInt(cpf[i - 1]) * (11 - i);
    rest = (sum * 10) % 11;
    if (rest === 10 || rest === 11) rest = 0;
    if (rest !== parseInt(cpf[9])) return false;

    sum = 0;
    for (let i = 1; i <= 10; i++) sum += parseInt(cpf[i - 1]) * (12 - i);
    rest = (sum * 10) % 11;
    if (rest === 10 || rest === 11) rest = 0;
    return rest === parseInt(cpf[10]);
};

const validateCnpj = (cnpj) => {
    if (/^(\d)\1{13}$/.test(cnpj)) return false;

    let length = cnpj.length - 2, numbers = cnpj.substring(0, length),
        digits = cnpj.substring(length), sum = 0, pos = length - 7;
    
    for (let i = length; i >= 1; i--) {
        sum += numbers[length - i] * pos--;
        if (pos < 2) pos = 9;
    }

    let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (result !== parseInt(digits[0])) return false;

    length++;
    numbers = cnpj.substring(0, length);
    sum = 0;
    pos = length - 7;
    
    for (let i = length; i >= 1; i--) {
        sum += numbers[length - i] * pos--;
        if (pos < 2) pos = 9;
    }

    result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    return result === parseInt(digits[1]);
};


const validaCpfCnpj = async (cpf_cnpj, sequelize) => {
    if (!isValidCpfCnpj(cpf_cnpj)) {
        return 'cpf_invalid';
    }

    const result = await sequelize.query(
        `SELECT ns.chavenfe
        FROM nota_saida ns
        JOIN cliente c ON c.id_cliente = ns.id_cliente
        WHERE (c.cpf = :cpf_cnpj OR ns.intelipost_order = :cpf_cnpj OR c.cnpj = :cpf_cnpj)`,
        {
            type: Sequelize.QueryTypes.SELECT,
            replacements: { cpf_cnpj }
        }
    );

    return result.length === 0 ? 'registro_nao_encontrado' : true;
};

module.exports = { validaCpfCnpj };
