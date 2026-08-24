import { createApplication } from './app.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const { httpServer } = await createApplication();

httpServer.listen(port, () => {
  console.log(`Serwer działa na porcie ${port}!`);
});
