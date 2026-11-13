import type { SessionTool } from '../pi/RunChannel.ts';

export const imageTools: SessionTool[] = [
  {
    name: 'generate_image',
    description:
      'Create one PNG with the explicitly configured studio-wide paid Images API tool. With references, generate/edit using the supplied images through Images edits; without references, generate from text. Reference paths are relative to the CURRENT PROJECT ROOT, including copied first-message attachments, prior agent outputs and previous generated images. Read get_run_context/list_project_files for exact paths. The source files remain unchanged. Available only when this session runtime is confirmed not to generate images natively. Use only for the requested image operation, never as automatic fallback after a native generator error, quota or unknown capability. Agent model/account stay unchanged; output is written to this agent output. On uncertain results do not repeat: read get_image_operation and ask the user. retryOperationId permits a new paid attempt only after a new user request explicitly approves repeating that operation.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 32000 },
        size: { enum: ['auto', '1024x1024', '1536x1024', '1024x1536'] },
        quality: { enum: ['auto', 'low', 'medium', 'high'] },
        background: { enum: ['auto', 'opaque', 'transparent'] },
        references: {
          type: 'array',
          maxItems: 16,
          uniqueItems: true,
          description:
            'PNG/JPEG/WebP paths relative to the project root, in reference order. Up to 32 MiB each, 64 MiB total. No URLs, base64 or paths outside the project. Use converted attachment.image.path for SVG/HEIC inputs when available.',
          items: { type: 'string', minLength: 1, maxLength: 2000 },
        },
        retryOperationId: { type: 'string', format: 'uuid' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_image_operation',
    description:
      'Read the local state of one image operation belonging to this exact project agent. Stored path is relative to the project root. No generation or retry. An uncertain/pending result may already have incurred an API charge; the Images endpoint has no recovery lookup here. Inspect status and ask the user before a new paid attempt.',
    inputSchema: {
      type: 'object',
      properties: { operationId: { type: 'string', format: 'uuid' } },
      required: ['operationId'],
      additionalProperties: false,
    },
  },
];
