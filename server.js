const express = require('express');
const cors = require('cors');
const { Sequelize } = require('sequelize');
const sequelize = require('./database'); // Importa a instância do Sequelize

const app = express();
const port = 3000;

// Middleware para permitir CORS
app.use(cors({
  origin: 'http://localhost:4200', 
  methods: 'GET',
  allowedHeaders: 'Content-Type,Authorization'
}));

// Middleware para permitir JSON no corpo da requisição
app.use(express.json());

app.get('/api/pedido/:cpf_cnpj', async (req, res) => {
  try {
    const cpf_cnpj = req.params.cpf_cnpj.trim(); // Remove espaços em branco

    const result = await sequelize.query(
      `SELECT ns.chavenfe,
          ns.marketplace_pedido,
          ns.data_emissao,
          ns.transportadora_ecommerce,
          ns.id_nr_nf,
          p.descricao_fiscal,
          p.imagem1,
          ns.intelipost_order as codigo_rastreio
        FROM nota_saida ns
        JOIN cliente c ON c.id_cliente = ns.id_cliente
        JOIN nota_saida_itens nsi ON ns.id_nota_saida = nsi.id_nota_saida   
        JOIN produto p ON p.id_produto = nsi.id_produto 
        WHERE (c.cpf = :cpf_cnpj OR ns.intelipost_order = :cpf_cnpj)
        AND ns.chavenfe <> ''
        AND LOWER(ns.marketplace_pedido) NOT LIKE '%!_%' ESCAPE '!'`, // Define '!' como escape
      {
        type: Sequelize.QueryTypes.SELECT,
        replacements: { cpf_cnpj: cpf_cnpj } // Passando o valor diretamente
      }
    );
    

    console.log('Resultado da query:', result);

    if (result.length > 0) {
      // Agrupar por `chavenfe`
      const pedidosAgrupados = result.reduce((acc, item) => {
        const { chavenfe, marketplace_pedido, data_emissao, transportadora_ecommerce, id_nr_nf,codigo_rastreio, descricao_fiscal, imagem1 } = item;
        
        if (!acc[chavenfe]) {
          acc[chavenfe] = {
            chavenfe,
            marketplace_pedido,
            data_emissao,
            transportadora_ecommerce,
            id_nr_nf,
            codigo_rastreio,
            produtos: []
          };
        }

        acc[chavenfe].produtos.push({
          descricao_fiscal,
          imagem1
        });

        return acc;
      }, {});

      res.json({ pedidos: Object.values(pedidosAgrupados) });
    } else {
      res.json({ pedidos: [], message: 'CPF/CNPJ não encontrado' }); 
    }
  } catch (err) {
    console.error('Erro ao executar a query:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
