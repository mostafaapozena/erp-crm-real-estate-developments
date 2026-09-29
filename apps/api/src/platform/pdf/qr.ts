import qrcode from 'qrcode-generator';

/**
 * A QR code as a module matrix (CORE-DOC-005). Drawn as vector squares, never as an embedded image,
 * so it stays sharp at any print size. Error correction `M` (15 %) tolerates a fold or a smudge on a
 * printed page while keeping a short verification link in a small symbol.
 */
export interface QrMatrix {
  size: number;
  isDark(row: number, column: number): boolean;
}

export function qrMatrix(text: string): QrMatrix {
  const code = qrcode(0, 'M');
  code.addData(text, 'Byte');
  code.make();
  return {
    size: code.getModuleCount(),
    isDark: (row, column) => code.isDark(row, column),
  };
}
