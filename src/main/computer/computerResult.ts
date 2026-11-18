import type { ToolResult } from '@trycua/cua-driver';

export interface ComputerResult {
  content: ({ type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string })[];
  isError?: boolean;
}
export function computerResult(result: ToolResult): ComputerResult {
  return {
    ...(result.isError ? { isError: true } : {}),
    content: [
      { type: 'text', text: result.text || result.structuredJson || result.rawJson },
      ...result.images.map((image) => ({
        type: 'image' as const,
        mimeType: image.mimeType,
        data: image.dataBase64,
      })),
    ],
  };
}
