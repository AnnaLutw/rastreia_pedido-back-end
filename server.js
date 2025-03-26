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
const token = process.env.TOKEN_DIGISAC;
const url_api = process.env.API_URL_DIGISAC

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
  console.log('body:  ' , req.body);

  const { data } = req.body;
  const { contactId, command, message, serviceId } = data;
  
  if (!contactId || !command || !message?.text) {
      return res.status(400).json({ flag: 'error', message: 'Dados obrigatórios ausentes' });
  }


  let response = {};
  let flag = '';

  switch (command) {
      case 'validaCpf':
          response = await validaCpfCnpj(message.text, sequelize);
          flag = response.flag;  // Ajustado para pegar a flag corretamente
          break;

      case 'InfomarEmail':
          flag = 'put_number_order';
          response = { flag, message: 'Email recebido e processado' };
          break;

      default:
          return res.status(400).json({ flag: 'unknown_command', message: 'Comando desconhecido' });
  }

  await enviarTriggerSignal(serviceId, contactId, flag);
  console.log('response :    ' , response)
  res.status(200).json(response);
});


const enviarTriggerSignal = async (botId, contactId, flag) => {

  const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
  };
  console.log(' url: ' , url_api)

  const url = `https://fidcomex.digisac.co/api/v1/bots/${botId}/trigger-signal/${contactId}?flag=${flag}`;

  console.log(' url: ' , url)

  try {
      const response = await axios.post(url, {}, { headers });
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
