import * as net from 'net';
import { TcpConn, soInit, soRead, soWrite } from './tcpconn';
import { DynBuf, bufPush, bufPop, cutMessage, } from './dynbuf';
import { httpReq, httpRes, } from './http';

async function newConnection(socket: net.Socket): Promise<void> {
  const conn: TcpConn = soInit(socket);
  try {
    await ServeClient(conn);
  }
  catch (err) {
    console.error('exception:', err);
    if (err instanceof HTTPError) {
      // send error response
      const res: httpRes = {
        code: err.code,
        headers: [],
        body: readerFromMemory(Buffer.from(err.message + '\n')),
      };
      try {
        await writeHttpResponse(conn, res);
      } catch (writeErr) { /* ignore */ }
    }
  } finally {
    socket.destroy(); // close the socket when done
  }
}

// Parse and remove a complete message from the incoming byte stream.
// Append some data to the buffer.
// Continue the loop if the message is incomplete.
// Handle the message.
// Send the response.
async function ServeClient(conn: TcpConn): Promise<void> {
  const socket: net.Socket = conn.socket;
  const buf: DynBuf = { data: Buffer.alloc(0), length: 0, headPtr: 0 };
  while (true) {
    const msg: null | httpReq = cutMessage(buf);
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
        throw new HTTPError(400, 'Unexpected EOF');
      }
      // got some data, try to get a message again
      continue;
    }

    // got a complete message, handle it
    const reqBody: BodyReader = readerFromReq(conn, buf, msg);
    const res: httpRes = await handleRequest(msg, reqBody);
    await writeHttpResponse(conn, res);
    // if the request is HTTP/1.0, we close the connection after sending the response
    if (msg.version === 'HTTP/1.0') {
      return;
    }
    // make sure request body is consumed completely
    while ((await reqBody.read()).length > 0) {

    }
  } //loop for msgs
}

//net.createServer() function creates a listening socket whose type is net.Server. 
//net.Server has a listen() method to bind and listen on an address.
let server = net.createServer({
  pauseOnConnect: true, // Required by TcpConn, 'data' event paused until we read from socket
});
server.on("connection", newConnection);
server.on("error", (err: Error) => { throw err; });
server.listen({ host: '127.0.0.1', port: 1234 });


