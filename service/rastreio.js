// service/rastreio.js
const axios = require('axios');
const { Sequelize } = require('sequelize');
const sequelize = require('../database');

require('dotenv').config();

const pedidos_rastreio = async (cpf_cnpj) => {
  cpf_cnpj = cpf_cnpj.trim();

  cpf_cnpj = cpf_cnpj.length <= 11
    ? cpf_cnpj.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
    : cpf_cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');

  const result = await sequelize.query(
    `SELECT ns.chavenfe,
            ns.marketplace_pedido,
            ns.data_emissao,
            ns.transportadora_ecommerce,
            ns.id_nr_nf,
            p.descricao_fiscal,
            p.imagem1,
            ns.intelipost_order as codigo_rastreio,
            CASE 
                WHEN ns.parceiro = 'FIDCOMERCIOEXTERIOREIRELI' THEN 'Mercado Livre' 
                WHEN ns.parceiro LIKE '%WAP%' THEN 'Fid Comex Site' 
                WHEN ns.parceiro = 'CASAS BAHIA MARKETPLACE' THEN 'Casas Bahia' 
                WHEN ns.parceiro = 'MAGAZINE LUIZA' THEN 'Magazine Luiza' 
                WHEN ns.parceiro = 'LEROY MERLIN' THEN 'Leroy Merlin' 
                WHEN ns.parceiro = 'LOJAS AMERICANAS' THEN 'Lojas Americanas' 
                WHEN ns.parceiro = 'SHOPEE' THEN 'Shopee' 
                ELSE ns.parceiro 
            END AS portal
    FROM sysemp.nota_saida ns
    JOIN sysemp.cliente c ON c.id_cliente = ns.id_cliente
    JOIN sysemp.nota_saida_itens nsi ON ns.id_nota_saida = nsi.id_nota_saida   
    JOIN sysemp.produto p ON p.id_produto = nsi.id_produto 
    WHERE (c.cpf = :cpf_cnpj OR ns.intelipost_order = :cpf_cnpj OR c.cnpj = :cpf_cnpj)
    AND ns.chavenfe <> ''
    AND ns.marketplace_pedido <> ''
    AND LOWER(ns.marketplace_pedido) NOT LIKE '%!_%' ESCAPE '!'
    AND LOWER(ns.marketplace_pedido) NOT LIKE '%RE' ESCAPE '!'
    ORDER BY ns.data_emissao DESC`,
    {
      type: Sequelize.QueryTypes.SELECT,
      replacements: { cpf_cnpj: cpf_cnpj }
    }
  );
  console.log(result)
  if (result.length === 0) {
    return { pedidos: [], message: 'CPF/CNPJ não encontrado' };
  }

  const pedidosAgrupados = result.reduce((acc, item) => {
    const { chavenfe, marketplace_pedido, data_emissao, transportadora_ecommerce, id_nr_nf, codigo_rastreio, descricao_fiscal, imagem1, portal } = item;

    if (!acc[chavenfe]) {
      acc[chavenfe] = {
        chavenfe,
        marketplace_pedido,
        data_emissao,
        transportadora_ecommerce,
        id_nr_nf,
        codigo_rastreio,
        portal,
        produtos: []
      };
    }

    acc[chavenfe].produtos.push({ descricao_fiscal, imagem1 });
    
    return acc;
  }, {});

  const pedidosComTracking = await Promise.all(
    Object.values(pedidosAgrupados).map(async (pedido) => {
      if (!pedido.codigo_rastreio) {
        return { ...pedido, trackingInfo: null };
      }

      try {
        const response = await axios.get(
          `https://api.intelipost.com.br/api/v1/shipment_order/${pedido.codigo_rastreio}`,
          {
            headers: { 'api-key': process.env.API_KEY_INTELIPOST }
          }
        );

        return { ...pedido, trackingInfo: response.data };
      } catch (error) {
        console.error(`Erro ao buscar tracking para pedido ${pedido.codigo_rastreio}:`, error.message);
        return { ...pedido, trackingInfo: null };
      }
    })
  );
 
  return pedidosComTracking;
};

module.exports = { pedidos_rastreio };
