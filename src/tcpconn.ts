import net from 'net';

// Promise-based API for TCP connections
export type TcpListener = {
  socket: net.Server, // the underlying net.Server socket
}
export type TcpConn = {
  socket: net.Socket,
  err: null | Error,
  ended: boolean,
  // callbacks of the promise of current read operation, returned by soRead()
  reader: null | {
    resolve: (value: Buffer) => void,
    reject: (reason: Error) => void,
  }
}

// Wraps a raw TCP socket (net.Socket) into a TCPConn abstraction
export function soInit(socket: net.Socket): TcpConn {
  const conn: TcpConn = {
    socket: socket,
    err: null,
    ended: false,
    reader: null,
  };
  socket.on('data', (data: Buffer) => {
    console.assert(conn.reader); // there should be a reader waiting for data
    conn.socket.pause();
    conn.reader!.resolve(data);
    conn.reader = null;
  });
  socket.on('error', (err: Error) => {
    // deliver err to current read 
    conn.err = err;
    if (conn.reader) {
      conn.reader.reject(err); // reject the read promise with the error
      conn.reader = null;
    }
  });
  socket.on('end', () => {
    conn.ended = true;
    if (conn.reader) {
      conn.reader.resolve(Buffer.from('')); // resolve with empty buffer ,EOF
      conn.reader = null; //clear reader
    }
  });
  return conn;
}

export function soRead(conn: TcpConn): Promise<Buffer> {
  console.assert(!conn.reader); // no concurrent reads
  return new Promise<Buffer>((resolve, reject) => {
    // if connection is unreadable, complete the promise immediately
    if (conn.err) {
      reject(conn.err);
      return;
    }
    if (conn.ended) {
      resolve(Buffer.from('')); // resolve with empty buffer, EOF
      return;
    }
    // save the promise callbacks
    conn.reader = { resolve: resolve, reject: reject };
    // resume the 'data' event to fulfill the promise when data arrives
    conn.socket.resume();
  });
}

// socket.write() accepts a callback, so conversion to a promise is trivial.
export function soWrite(conn: TcpConn, data: Buffer): Promise<void> {
  console.assert(data.length > 0);
  return new Promise((resolve, reject) => {
    if (conn.err) {
      reject(conn.err);
    }
    conn.socket.write(data, () => {
      resolve();
    });
  });
} 
