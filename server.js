const express = require('express');
const cors = require('cors');
const { Sequelize } = require('sequelize');
const axios = require('axios'); // 📌 Importando Axios para fazer requisições HTTP
const sequelize = require('./database'); // Importa a instância do Sequelize
require('dotenv').config(); // Carrega variáveis do .env
const { pedidos_rastreio } = require('./service/rastreio'); // Importa a função de rastreio
const { webhook } = require('./webhook/webhook'); // Importa a função de rastreio

const app = express();
const port = process.env.PORT || 3000

app.use((req, res, next) => {
  const allowedOrigin = "https://fidcomex.up.railway.app";
  // const allowedOrigin = "http://localhost:4200";
  
  if (req.headers.origin === allowedOrigin) {
    res.header("Access-Control-Allow-Origin", allowedOrigin);
  }
  
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

// Middleware para permitir JSON no corpo da requisição
app.use(express.json());

app.get('/api/pedido/:cpf_cnpj', async (req, res) => {
  try {
    const { cpf_cnpj } = req.params;
    const all_pedidos = await pedidos_rastreio(cpf_cnpj);

    // 🔹 4. Retornar os pedidos com os dados da Intelipost
    res.json({ pedidos: all_pedidos });

  } catch (err) {
    console.error('Erro ao executar a query:', err);
    res.status(500).json({ error: err.message });
  }
});



app.post('/api/webhook', (req, res) => {

  console.log(req.bo)


  // if (!evento || !dados || !dados.flag) {
  //     return res.status(400).json({ error: 'Evento e flag são obrigatórios.' });
  // }

  // console.log('Webhook recebido:', req.body);


  // switch (dados.command) {
  //     case 'validaCpfCnpj':
  //         console.log('Iniciando conversa com o usuário...');
  //         valida_cpf_cnpj()
  //         break;

  //     case 'finalizar_atendimento':
  //         console.log('Finalizando atendimento...');
  //         // Aqui você pode registrar o encerramento no banco de dados
  //         break;

  //     case 'enviar_mensagem':
  //         console.log(`Enviando mensagem: ${dados.mensagem}`);
  //         // Aqui pode chamar uma API para enviar uma mensagem para o usuário
  //         break;

  //     default:
  //         console.log('Flag desconhecida:', dados.flag);
  //         return res.status(400).json({ error: 'Flag desconhecida' });
  // }

  res.status(200).json({ success: true, message: 'Webhook processado com sucesso' });
});


app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
