export interface ServerClientOptions {
  baseUrl: string;
  token: string;
}

export interface ServerClient {
  createDocument: (
    name: string,
    content: Record<string, unknown>
  ) => Promise<void>;
  deleteDocument: (documentName: string) => Promise<void>;
}

export function createServerClient(options: ServerClientOptions): ServerClient {
  const { baseUrl, token } = options;

  const defaultHeaders = {
    Authorization: token,
    "Content-Type": "application/json",
  } as const;

  /** Create a new document with the given name and content. */
  async function createDocument(
    name: string,
    content: Record<string, unknown>
  ) {
    const response = await fetch(
      `${baseUrl}/api/documents/${encodeURIComponent(name)}?format=json`,
      {
        headers: {
          ...defaultHeaders,
        },
        method: "POST",
        body: JSON.stringify(content),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to create document: ${response.status} ${response.statusText}`
      );
    }
  }





  async function deleteDocument(documentName: string) {
    const response = await fetch(
      `${baseUrl}/api/documents/${encodeURIComponent(documentName)}`,
      {
        headers: defaultHeaders,
        method: "DELETE",
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to delete document: ${response.status} ${response.statusText}`
      );
    }
  }

  return { createDocument, deleteDocument };
}
