import * as net from "net";
import { TcpConn, soInit, soRead, soWrite } from "./tcpconn";
import { DynBuf, bufPush, cutMessage } from "./dynbuf";
import {
  HTTP_Request,
  HTTP_Response,
  HTTPError,
  BodyReader,
  fieldGet,
  encodeHTTPResponse,
  readerFromReq,
} from "./http";

async function newConnection(socket: net.Socket): Promise<void> {
  const conn: TcpConn = soInit(socket);
  try {
    await ServeClient(conn);
  } catch (err) {
    console.error("exception:", err);
    if (err instanceof HTTPError) {
      // send error response
      const res: HTTP_Response = {
        code: err.code,
        headers: [],
        body: readerFromMemory(Buffer.from(err.message + "\n")),
      };
      try {
        await writeHttpResponse(conn, res);
      } catch (writeErr) {
        /* ignore */
      }
    }
  } finally {
    socket.end(); // close the socket when done
  }
}

// Parse and remove a complete message from the incoming byte stream.
// Append some data to the buffer.
// Continue the loop if the message is incomplete.
// Handle the message.
// Send the response.
async function ServeClient(conn: TcpConn): Promise<void> {
  const buf: DynBuf = { data: Buffer.alloc(0), length: 0, headPtr: 0 };
  while (true) {
    const msg: null | HTTP_Request = cutMessage(buf);
    if (!msg) {
      //need more data to complete the message
      const data: Buffer = await soRead(conn);
      bufPush(buf, data);
      // EOF?
      if (data.length === 0 && buf.length === 0) {
        // no more requests
        return;
      }
      if (data.length === 0) {
        throw new HTTPError(400, "Unexpected EOF");
      }
      // got some data, try to get a message again
      continue;
    }

    // got a complete message, handle it
    const reqBody: BodyReader = readerFromReq(conn, buf, msg);
    const res: HTTP_Response = await handleRequest(msg, reqBody);
    await writeHttpResponse(conn, res);
    // if the request is HTTP/1.0, we close the connection after sending the response
    if (msg.version === "HTTP/1.0") {
      return;
    }
    // make sure request body is consumed completely
    while (true) {
      const data = await reqBody.read();
      if (data === null || data.length === 0) {
        break; // EOF
      }
    }
  } 
}

async function handleRequest(
  req: HTTP_Request,
  body: BodyReader,
): Promise<HTTP_Response> {
  let response: BodyReader;
  switch (req.uri.toString("ascii")) {
    case "/echo":
      response = body;
      break;
    default:
      response = readerFromMemory(Buffer.from("Hello World!\n"));
      break;
  }
  return {
    code: 200,
    headers: [Buffer.from("Server: My first HTTP server")],
    body: response,
  };
}

async function writeHttpResponse(
  conn: TcpConn,
  resp: HTTP_Response,
): Promise<void> {
  if (resp.body.length < 0) {
    // TODO: CHUNKED transfer encoding
    throw new HTTPError(501, "unknown body length not implemented");
  }
  // Set the response headers (Content-Length)
  console.assert(!fieldGet(resp.headers, "Content-Length")); // should not be set
  resp.headers.push(Buffer.from(`Content-Length: ${resp.body.length}`));
  // write the headers
  await soWrite(conn, encodeHTTPResponse(resp));
  // write the body
  while (true) {
    const data = await resp.body.read();
    if (data === null || data.length === 0) {
      break; // EOF
    }
    await soWrite(conn, data);
  }
}

function readerFromMemory(data: Buffer): BodyReader {
  let done = false;
  return {
    length: data.length,
    read: async (): Promise<Buffer | null> => {
      if (done) {
        return Buffer.from(""); // EOF
      } else {
        done = true; // only read once
        return data; // return the data
      }
    },
  };
}

//net.createServer() function creates a listening socket whose type is net.Server.
//net.Server has a listen() method to bind and listen on an address.
let server = net.createServer({
  pauseOnConnect: true, // Required by TcpConn, 'data' event paused until we read from socket
});
server.on("connection", newConnection);
server.on("error", (err: Error) => {
  throw err;
});
server.listen({ host: "127.0.0.1", port: 1234 });
