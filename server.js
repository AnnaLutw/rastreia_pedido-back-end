const express = require('express');
const cors = require('cors');
const { Sequelize } = require('sequelize');
const axios = require('axios'); // 📌 Importando Axios para fazer requisições HTTP
const sequelize = require('./database'); // Importa a instância do Sequelize
require('dotenv').config(); // Carrega variáveis do .env
const { pedidos_rastreio } = require('./service/rastreio'); // Importa a função de rastreio
const { validaCpfCnpj } = require('./webhook/webhook'); // Importa a função de rastreio

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


app.post('/api/webhook', async (req, res) => {
  const { id, contactId, command, message } = req.body;
  if (!contactId || !command || !message?.text) {
      return res.status(400).json({ flag: 'error', message: 'Dados obrigatórios ausentes' });
  }
  console.log(message)

  let response;
  let flag = '';

  switch (command) {
      case 'validaCpf':
          response = await validaCpfCnpj(message.text, sequelize);
          flag = response.flag;
          console.log(response)
          break;
      
      case 'InfomarEmail':
          flag = 'put_number_order';
          response = { flag, message: 'Email recebido e processado' };
          break;

      default:
          return res.status(400).json({ flag: 'unknown_command', message: 'Comando desconhecido' });
  }

  const triggerResponse = await enviarTriggerSignal(id, contactId, flag);

  if (!triggerResponse.success) {
      return res.status(500).json({ flag: 'error', message: 'Erro ao acionar trigger', details: triggerResponse.error });
  }

  res.status(200).json({ ...response, trigger: triggerResponse.data });
});


const axios = require('axios');

const enviarTriggerSignal = async (botId, contactId, flag) => {
    const token = process.env.TOKEN; // Corrigi para usar a variável correta do ambiente

    const headers = {
        'Authorization': `Bearer ${token}`, // Correção na interpolação da string
        'Content-Type': 'application/json' // Garante que a API recebe JSON
    };

    const url = `${process.env.API_URL}/api/v1/bots/${botId}/trigger-signal/${contactId}?flag=${flag}`;

    try {
        const response = await axios.post(url, {}, { headers }); // Corrigido para passar {} como corpo e headers corretamente
        console.log('Trigger enviado com sucesso:', response.data);
        return { success: true, data: response.data };
    } catch (error) {
        console.error('Erro ao enviar trigger:', error.response?.data || error.message);
        return { success: false, error: error.response?.data || error.message };
    }
};


app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
