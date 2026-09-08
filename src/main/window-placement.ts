export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

const WINDOW_GAP = 12;

export function getLogcatWindowPosition(
  mainBounds: Rectangle,
  workArea: Rectangle,
  logcatWidth: number
): { x: number; y: number } | undefined {
  const x = mainBounds.x + mainBounds.width + WINDOW_GAP;
  const rightEdge = workArea.x + workArea.width;

  if (x + logcatWidth > rightEdge) {
    return undefined;
  }

  return {
    x,
    y: Math.max(workArea.y, mainBounds.y)
  };
}
