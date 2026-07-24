declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }

  type LibraryManagedAttributes<C, P> = P & { key?: string | number | null };
}
