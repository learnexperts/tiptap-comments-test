/** Claims accepted by the local TipTap collaboration server JWT verifier. */
export interface TiptapClaims {
  sub: string;
  allowedDocumentNames?: string[];
  readonlyDocumentNames?: string[];
  commentDocumentNames?: string[];
  iat?: number;
  exp?: number;
}

interface CommentClaimsOptions {
  documentName: string;
  sub: string;
}

export function commentClaims({
  documentName,
  sub,
}: CommentClaimsOptions): TiptapClaims {
  return {
    sub,
    allowedDocumentNames: [],
    readonlyDocumentNames: [documentName],
    commentDocumentNames: [documentName],
  };
}

export function editClaims({
  documentName,
  sub,
}: CommentClaimsOptions): TiptapClaims {
  return {
    sub,
    allowedDocumentNames: [documentName],
    readonlyDocumentNames: [],
    commentDocumentNames: [],
  };
}
