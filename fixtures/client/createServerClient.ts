export interface ServerClientOptions {
  baseUrl: string;
  token: string;
}

export interface ServerClient {
  createDocument: (
    name: string,
    content: Record<string, unknown>
  ) => Promise<void>;
  checkHealth: () => Promise<boolean>;
  getThread: (documentName: string, threadId: string) => Promise<any>;
  getDocument: (documentName: string) => Promise<any>;
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

  /** Check if the server is healthy. */
  async function checkHealth() {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: defaultHeaders,
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  async function getThread(documentName: string, threadId: string) {
    const response = await fetch(
      `${baseUrl}/api/documents/${encodeURIComponent(
        documentName
      )}/threads/${encodeURIComponent(threadId)}`,
      {
        headers: defaultHeaders,
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to get thread: ${response.status} ${response.statusText}`
      );
    }

    return response.json();
  }

  async function getDocument(documentName: string) {
    const response = await fetch(
      `${baseUrl}/api/documents/${encodeURIComponent(
        documentName
      )}?format=json`,
      {
        headers: defaultHeaders,
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to get document: ${response.status} ${response.statusText}`
      );
    }

    return response.json();
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

  return {
    createDocument,
    checkHealth,
    getThread,
    getDocument,
    deleteDocument,
  };
}
