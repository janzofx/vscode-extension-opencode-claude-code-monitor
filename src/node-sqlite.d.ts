declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string, options?: { readonly?: boolean });
    prepare(sql: string): StatementSync;
    close(): void;
  }

  export class StatementSync {
    all(...params: any[]): any[];
    get(...params: any[]): any;
  }
}
