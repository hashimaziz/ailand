import './style.css';
import { App } from './app/App';

async function bootstrap() {
  const container = document.getElementById('app');
  if (!container) {
    throw new Error('Could not find #app container');
  }

  const app = new App(container);
  await app.initialize();
  app.start();
}

bootstrap().catch(console.error);
