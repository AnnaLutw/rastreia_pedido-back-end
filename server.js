const express = require('express');
const cors = require('cors');
const { Sequelize } = require('sequelize');
const axios = require('axios'); // 📌 Importando Axios para fazer requisições HTTP
const sequelize = require('./database'); // Importa a instância do Sequelize
require('dotenv').config(); // Carrega variáveis do .env
const { pedidos_rastreio } = require('./service/rastreio'); // Importa a função de rastreio
const { 
    enviaRastreio, 
    enviaNFE,
    validaParaTroca,
    validaEmailOutrosAssuntos
} = require('./webhook/webhook'); // Importa a função de rastreio

const app = express();
const port = process.env.PORT || 3000
const token = '19321bfe50f0740a7c8663197e22b79644f80268'
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
  const { data } = req.body;
  const { contactId, command, message, serviceId, id } = data;

  if (!contactId || !command || !message?.text) {
      return res.status(400).json({ flag: 'error', message: 'Dados obrigatórios ausentes' });
  }


  let response = {};
  let flag = '';

  switch (command) {
      case 'validaCpf':
          response = await enviaRastreio(message.text, sequelize, contactId);
          break;
      case 'rastreioPeloPedido':
            response = await enviaRastreio(message.text, sequelize, contactId, 'pedido');
            break;
      case 'nfePeloPedido':
            response = await enviaNFE(message.text, sequelize, contactId, 'pedido');
            break;
      case 'enviaNFECliente':
            response = await enviaNFE(message.text, sequelize, contactId);
            break;
      case 'validaCpfParaTroca':
            response = await validaParaTroca(message.text, sequelize, contactId);
            break;
      case 'validaPedidoParaTroca':
            response = await validaParaTroca(message.text, sequelize, contactId, 'pedido');
            break;
      case 'validaEmailOutrosAssuntos':
            response = await validaEmailOutrosAssuntos(message.text, sequelize, contactId);
            break;
      default:
          return res.status(400).json({ flag: 'unknown_command', message: 'Comando desconhecido' });



  }
  flag = response.flag;

  if(command != 'enviaUrlRastreio'){
    await enviarTriggerSignal(id, contactId, flag);
      
  }
  console.log('comando: ',command)
  console.log('response :    ' , response)
  console.log('message :    ' , message.text)
  res.status(200).json(response);
});


const enviarTriggerSignal = async (botId, contactId, flag) => {

  const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
  };
  const url = `https://fidcomex.digisac.co/api/v1/bots/${botId}/trigger-signal/${contactId}?flag=${flag}`;

  try {
      const response = await axios.post(url, {}, { headers });
      return { success: true, data: response.data };
  } catch (error) {
      console.error('Erro ao enviar trigger:', error.response?.data || error.message);
      return { success: false, error: error.response?.data || error.message };
  }
};


app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
