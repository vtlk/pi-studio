import type { SessionTool } from '../pi/RunChannel.ts';

export const imageTools: SessionTool[] = [
  {
    name: 'generate_image',
    description:
      'Create one PNG with the explicitly configured studio-wide paid Images API tool. Available only when this session runtime is confirmed not to generate images natively. Use only for the requested image operation, never as an automatic fallback after a native generator error, quota or unknown capability. The current agent model/account stay unchanged. Output is written to this agent output. On an uncertain result do not repeat: read get_image_operation and ask the user. retryOperationId permits a new paid attempt only after a new user request explicitly approves repeating that operation; it never recovers an unknown remote result automatically. This tool creates a new image, it does not edit references.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 32000 },
        size: { enum: ['auto', '1024x1024', '1536x1024', '1024x1536'] },
        quality: { enum: ['auto', 'low', 'medium', 'high'] },
        background: { enum: ['auto', 'opaque', 'transparent'] },
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
