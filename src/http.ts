import { TcpConn } from "./tcpconn";
import { DynBuf } from "./dynbuf";

// A parsed HTTP request header
export type HTTP_Req = {
  method: string; // e.g., 'GET', 'POST'
  uri: Buffer; // e.g., '/index.html'
  version: string; // e.g., 'HTTP/1.1'
  headers: Buffer[];
}

// there is no guarantee that URI and header fields will be ASCII or UTF-8 strings
// so we use Buffer for them, and leave them as bytes until we need to decode them

export type httpRes = {
  code: number,
  headers: Buffer[],
  body: BodyReader,
}

// an interface for reading/writing data from/to the HTTP body.
export type BodyReader = {
  contentLength: number, // total length of the body, -1 if unknown
  read: () => Promise<Buffer | null>, // read a chunk of data, return null if EOF
};

function readerFromReq(conn: TcpConn, buf: DynBuf, req: HTTP_Req) {
  let bodyLen = -1; // unknown length by default
  const contentLength = fieldGet(req.headers, 'Content-Length');

  if (contentLength) {
    bodyLen = parseInt(contentLength.toString('ascii'), 10);
    if (isNaN(bodyLen) || bodyLen < 0) {
      throw new HTTPError(400, 'invalid Content-Length header');
    }
  }

  const bodyAllowed = fieldGet(req.method === 'GET' || req.method === 'HEAD');
  const chunked = fieldGet(req.headers, 'Transfer-Encoding')?.toString('ascii') === 'chunked';
  if (!bodyAllowed && (bodyLen > 0 || chunked)) {
    throw new HTTPError(400, 'body not allowed for ${req.method} method');
  }
  if (!bodyAllowed) {
    bodyLen = 0
  }
  if (bodyLen > 0) {
    return readerFromConnLength(conn, buf, bodyLen);
  } else if (chunked) {
    // TODO: chunked transfer encoding
    throw new HTTPError(501, 'chunked transfer encoding not implemented');
  } else {
    // no body or unknown length, return a reader that reads until EOF
    throw new HTTPError(501, 'unknown body length not implemented');
  }

}

export function parseHTTPReq(buf: Buffer): HTTP_Req {
  const lines: Buffer[] = splitLines(buf);
  const [method, uri, version] = parseRequestLine(lines[0]);
  const headers: Buffer[] = [];
  for (let i = 1; i < lines.length; i++) {
    const h = Buffer.from(lines[i]);
    // TODO: IMPLEMENT HEADER VALIDATION
    headers.push(h);
  }
  // headers terminated by empty line CLRF
  console.assert(lines[lines.length - 1].length === 0);

  return {
    method: method,
    uri: uri,
    version: version,
    headers: headers,
  }

}

function splitLines(buf: Buffer): Buffer[] {
  const lines: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0D && buf[i + 1] === 0x0A) { // CRLF
      lines.push(buf.subarray(start, i));
      start = i + 2; // move to the next line
      i++; // skip extra step since we handled 2 bytes (CRLF)
    }
  }
  // not expected, but if the last line doesn't end with CRLF, add it
  if (start < buf.length) {
    lines.push(buf.subarray(start));
  }
  return lines;
}

// request-line = method SP request-target SP HTTP-version
function parseRequestLine(line: Buffer): [string, Buffer, string] {
  const parts = line.toString('ascii').split(' ');
  if (parts.length !== 3) {
    throw new HTTPError(400, 'invalid request line');
  }
  const method = parts[0];
  const uri = Buffer.from(parts[1], 'ascii'); // keep as bytes
  const version = parts[2];
  if (!/^HTTP\/\d\.\d$/.test(version)) {
    throw new HTTPError(400, 'invalid HTTP version');
  }
  if (!/^[A-Z]+$/.test(method)) {
    throw new HTTPError(400, 'invalid HTTP method');
  }
  if (uri.length === 0 || uri[0] !== 0x2F) { // URI must start with '/'
    throw new HTTPError(400, 'invalid request URI');
  }
  return [method, uri, version];
}

export class HTTPError extends Error {
  code: number; // HTTP status code

  constructor(code: number, message: string) {
    super(message);
    this.name = 'HTTPError';
    this.code = code;
  }
}

