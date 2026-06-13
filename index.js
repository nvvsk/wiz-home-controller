const logger = require('./src/logger');
const WizServer = require('./src/server');

const PORT = process.env.PORT || 3000;
const server = new WizServer(PORT);

server.start().catch(error => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});

process.on('SIGINT', async () => {
  logger.info('\n\n🛑 Shutting down server...');
  await server.stop();
  process.exit(0);
});
