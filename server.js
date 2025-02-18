const express = require('express');
const cors = require('cors');
const { Sequelize } = require('sequelize');
const axios = require('axios'); // 📌 Importando Axios para fazer requisições HTTP
const sequelize = require('./database'); // Importa a instância do Sequelize
require('dotenv').config(); // Carrega variáveis do .env

const app = express();
const port = process.env.PORT || 3000

// Middleware para permitir CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); 
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});


// Middleware para permitir JSON no corpo da requisição
app.use(express.json());

app.get('/api/pedido/:cpf_cnpj', async (req, res) => {
  try {
    let cpf_cnpj = req.params.cpf_cnpj.trim(); // Remove espaços em branco

    cpf_cnpj = cpf_cnpj.length <= 11
        ? cpf_cnpj.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
        : cpf_cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');

    console.log(cpf_cnpj);

    // 🔹 1. Buscar pedidos no banco de dados
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
        FROM nota_saida ns
        JOIN cliente c ON c.id_cliente = ns.id_cliente
        JOIN nota_saida_itens nsi ON ns.id_nota_saida = nsi.id_nota_saida   
        JOIN produto p ON p.id_produto = nsi.id_produto 
        WHERE (c.cpf = :cpf_cnpj OR ns.intelipost_order = :cpf_cnpj OR c.cnpj = :cpf_cnpj)
        AND ns.chavenfe <> ''
        AND LOWER(ns.marketplace_pedido) NOT LIKE '%!_%' ESCAPE '!'
        AND LOWER(ns.marketplace_pedido) NOT LIKE '%RE' ESCAPE '!',
        and transportadora_ecommerce <> ''
        ORDER BY ns.data_emissao DESC`, 
      {
        type: Sequelize.QueryTypes.SELECT,
        replacements: { cpf_cnpj: cpf_cnpj }
      }
    );

    console.log('Resultado da query:', result);

    if (result.length === 0) {
      return res.json({ pedidos: [], message: 'CPF/CNPJ não encontrado' });
    }

    // 🔹 2. Agrupar os pedidos por `chavenfe`
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

    // 🔹 3. Fazer requisições para a API Intelipost para cada pedido
    const pedidosComTracking = await Promise.all(
      Object.values(pedidosAgrupados).map(async (pedido) => {
        if (!pedido.codigo_rastreio) {
          return { ...pedido, trackingInfo: null }; // Caso não tenha código de rastreio
        }

        try {
          const response = await axios.get(`https://api.intelipost.com.br/api/v1/shipment_order/${pedido.codigo_rastreio}`, {
            headers: { 'api-key': process.env.API_KEY_INTELIPOST } // Chave de API do .env
          });

          return { ...pedido, trackingInfo: response.data }; // Adiciona os dados da API Intelipost
        } catch (error) {
          console.error(`Erro ao buscar tracking para pedido ${pedido.codigo_rastreio}:`, error.message);
          return { ...pedido, trackingInfo: null }; // Retorna sem tracking caso dê erro
        }
      })
    );

    // 🔹 4. Retornar os pedidos com os dados da Intelipost
    res.json({ pedidos: pedidosComTracking });

  } catch (err) {
    console.error('Erro ao executar a query:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
