import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { resolve } from 'node:path';

const mode = process.argv[2];
const client = new Client({
  name: 'fcmatch-phase0-verification',
  version: '0.0.0',
});
try {
  if (mode === 'engram') {
    const executable =
      process.env['ENGRAM_BIN'] ?? resolve('../.tools/engram/engram.exe');
    await client.connect(
      new StdioClientTransport({
        command: executable,
        args: ['mcp'],
        stderr: 'inherit',
      }),
    );
    const listed = await client.listTools();
    console.info(
      `Engram: ${listed.tools.length} herramientas MCP disponibles.`,
    );
    const project = await client.callTool({
      name: 'mem_current_project',
      arguments: {},
    });
    if (project.isError)
      throw new Error('No se pudo resolver el proyecto de Engram.');
    console.info('Engram: proyecto resuelto por MCP.');
    const saved = await client.callTool({
      name: 'mem_save',
      arguments: {
        title: 'Fase 0: verificación MCP de infraestructura',
        type: 'discovery',
        topic_key: 'infra/phase0-mcp-verification',
        content:
          '**Qué**: comprobación técnica independiente de lectura y escritura MCP. **Por qué**: verificar la integración. **Dónde**: scripts/check-mcp.ts. No representa una sesión de agente OpenCode ni certifica exposición de herramientas en ella.',
      },
    });
    if (saved.isError) throw new Error('Falló la escritura MCP.');
    const found = await client.callTool({
      name: 'mem_search',
      arguments: { query: 'verificación MCP infraestructura' },
    });
    if (
      found.isError ||
      !JSON.stringify(found).includes(
        'Fase 0: verificación MCP de infraestructura',
      )
    )
      throw new Error('No se pudo recuperar por MCP la observación guardada.');
    console.info('Engram: escritura y consulta MCP completadas.');
  } else if (mode === 'stitch') {
    const key =
      process.env['STITCH_API_KEY'] ?? process.env['STITCH_API_KEY_USER'];
    if (!key)
      throw new Error(
        'Configura STITCH_API_KEY localmente antes de verificar Stitch.',
      );
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL('https://stitch.googleapis.com/mcp'),
        { requestInit: { headers: { 'X-Goog-Api-Key': key } } },
      ),
    );
    const tools = await client.listTools();
    if (!tools.tools.some((tool) => tool.name === 'list_projects'))
      throw new Error('No se encontró list_projects.');
    const result = await client.callTool({
      name: 'list_projects',
      arguments: {},
    });
    if (result.isError) throw new Error('Falló list_projects de Stitch.');
    console.info(
      `Stitch: conexión autenticada y list_projects verificados (${tools.tools.length} herramientas).`,
    );
  } else throw new Error('Usa engram o stitch como argumento.');
} catch (error) {
  console.error(
    error instanceof Error && mode !== 'stitch'
      ? error.message
      : 'Stitch no verificado: falta acceso o credencial válida.',
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
