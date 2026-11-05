import { SMTPServer } from 'smtp-server';

// Capturador exclusivamente local: descarta el contenido para no registrar tokens futuros.
const server = new SMTPServer({
  authOptional: true,
  disabledCommands: ['AUTH', 'STARTTLS'],
  onData(stream, _session, callback) {
    let bytes = 0;
    stream.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    stream.on('end', () => {
      console.info(
        `Correo local recibido (${bytes} bytes); contenido descartado.`,
      );
      callback();
    });
    stream.on('error', callback);
  },
});
server.listen(1025, '127.0.0.1', () =>
  console.info('Capturador SMTP local disponible en 127.0.0.1:1025.'),
);
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
