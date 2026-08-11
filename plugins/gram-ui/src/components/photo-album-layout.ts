export interface AlbumCellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AlbumLayout {
  cells: AlbumCellRect[];
  width: number;
  height: number;
}

const MAX_COMPLEX_LAYOUT_ROW_ITEMS = 3;
const MAX_COMPLEX_LAYOUT_LAST_ROW_ITEMS = 4;
const EXTENDED_LAYOUT_EXTRA_ROW_COUNT = 2;
const MIN_EXTENDED_LAYOUT_ROW_COUNT = 5;

function accumulate(list: number[], initValue: number): number {
  return list.reduce((accumulator, item) => accumulator + item, initValue);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getProportions(ratios: number[]): string {
  return ratios.map((ratio) => (ratio > 1.2 ? 'w' : (ratio < 0.8 ? 'n' : 'q'))).join('');
}

function getAverageRatio(ratios: number[]): number {
  return ratios.reduce((result, ratio) => ratio + result, 1) / ratios.length;
}

function buildLineCounts(count: number, maxCounts: number[]): number[][] {
  const lineCounts: number[][] = [];
  collectLineCounts(count, maxCounts, [], lineCounts);
  return lineCounts;
}

function collectLineCounts(
  remainingCount: number,
  maxCounts: number[],
  currentLineCounts: number[],
  result: number[][],
) {
  if (!maxCounts.length) {
    if (!remainingCount) {
      result.push([...currentLineCounts]);
    }
    return;
  }

  const [maxCurrentCount, ...restMaxCounts] = maxCounts;
  const maxRestCount = accumulate(restMaxCounts, 0);
  const minCurrentCount = Math.max(1, remainingCount - maxRestCount);
  const maxAllowedCount = Math.min(maxCurrentCount, remainingCount - restMaxCounts.length);

  for (let currentCount = minCurrentCount; currentCount <= maxAllowedCount; currentCount++) {
    currentLineCounts.push(currentCount);
    collectLineCounts(remainingCount - currentCount, restMaxCounts, currentLineCounts, result);
    currentLineCounts.pop();
  }
}

function buildBaseLineCounts(count: number, averageRatio: number): number[][] {
  return [
    [MAX_COMPLEX_LAYOUT_ROW_ITEMS, MAX_COMPLEX_LAYOUT_ROW_ITEMS],
    [
      MAX_COMPLEX_LAYOUT_ROW_ITEMS,
      averageRatio < 0.85 ? MAX_COMPLEX_LAYOUT_LAST_ROW_ITEMS : MAX_COMPLEX_LAYOUT_ROW_ITEMS,
      MAX_COMPLEX_LAYOUT_ROW_ITEMS,
    ],
    [
      MAX_COMPLEX_LAYOUT_ROW_ITEMS,
      MAX_COMPLEX_LAYOUT_ROW_ITEMS,
      MAX_COMPLEX_LAYOUT_ROW_ITEMS,
      MAX_COMPLEX_LAYOUT_LAST_ROW_ITEMS,
    ],
  ].flatMap((maxCounts) => buildLineCounts(count, maxCounts));
}

function buildExtendedLineCounts(count: number): number[][] {
  const minRowCount = Math.max(
    MIN_EXTENDED_LAYOUT_ROW_COUNT,
    Math.ceil((count - MAX_COMPLEX_LAYOUT_LAST_ROW_ITEMS) / MAX_COMPLEX_LAYOUT_ROW_ITEMS) + 1,
  );
  const maxRowCount = Math.min(count, minRowCount + EXTENDED_LAYOUT_EXTRA_ROW_COUNT);
  const lineCounts: number[][] = [];

  for (let rowCount = minRowCount; rowCount <= maxRowCount; rowCount++) {
    const currentLineCounts = buildExtendedLineCount(count, rowCount);
    if (currentLineCounts) {
      lineCounts.push(currentLineCounts);
    }
  }

  return lineCounts;
}

function buildExtendedLineCount(count: number, rowCount: number): number[] | undefined {
  const lineCounts = Array.from({ length: rowCount }, () => 1);
  const maxCounts = Array.from({ length: rowCount }, () => MAX_COMPLEX_LAYOUT_ROW_ITEMS);
  maxCounts[rowCount - 1] = MAX_COMPLEX_LAYOUT_LAST_ROW_ITEMS;

  if (count > accumulate(maxCounts, 0)) {
    return undefined;
  }

  let remainingCount = count - rowCount;
  for (let row = rowCount - 1; row >= 0 && remainingCount; row--) {
    const addedCount = Math.min(remainingCount, maxCounts[row] - lineCounts[row]);
    lineCounts[row] += addedCount;
    remainingCount -= addedCount;
  }

  return lineCounts;
}

function cropRatios(ratios: number[], averageRatio: number): number[] {
  return ratios.map((ratio) => {
    return (averageRatio > 1.1 ? clamp(ratio, 1, 2.75) : clamp(ratio, 0.6667, 1));
  });
}

interface ILayoutParams {
  ratios: number[];
  proportions: string;
  averageRatio: number;
  maxWidth: number;
  minWidth: number;
  maxHeight: number;
  spacing: number;
}

interface IAttempt {
  lineCounts: number[];
  heights: number[];
}

function layoutSingle({ ratios, maxWidth, maxHeight }: ILayoutParams): AlbumCellRect[] {
  const height = Math.round(Math.min(maxWidth / ratios[0], maxHeight));

  return [{
    x: 0,
    y: 0,
    width: maxWidth,
    height,
  }];
}

function layoutWithComplexLayouter(params: ILayoutParams): AlbumCellRect[] {
  const {
    ratios: originalRatios,
    averageRatio,
    maxWidth,
    minWidth,
    spacing,
  } = params;
  const maxHeight = (4 * maxWidth) / 3;
  const ratios = cropRatios(originalRatios, averageRatio);
  const count = originalRatios.length;
  const result: AlbumCellRect[] = new Array(count);
  const attempts: IAttempt[] = [];

  const multiHeight = (offset: number, attemptCount: number) => {
    const attemptRatios = ratios.slice(offset, offset + attemptCount);
    const sum = accumulate(attemptRatios, 0);

    return (maxWidth - (attemptCount - 1) * spacing) / sum;
  };

  const pushAttempt = (lineCounts: number[]) => {
    const heights: number[] = [];
    let offset = 0;
    lineCounts.forEach((currentCount) => {
      heights.push(multiHeight(offset, currentCount));
      offset += currentCount;
    });

    attempts.push({
      lineCounts,
      heights,
    });
  };

  buildBaseLineCounts(count, averageRatio).forEach(pushAttempt);

  if (!attempts.length) {
    buildExtendedLineCounts(count).forEach(pushAttempt);
  }

  let optimalAttempt: IAttempt | undefined;
  let optimalDiff = 0;
  for (let i = 0; i < attempts.length; i++) {
    const {
      heights,
      lineCounts,
    } = attempts[i];
    const lineCount = lineCounts.length;
    const totalHeight = accumulate(heights, 0) + spacing * (lineCount - 1);
    const minLineHeight = Math.min(...heights);
    const bad1 = minLineHeight < minWidth ? 1.5 : 1;
    const bad2 = (() => {
      for (let line = 1; line !== lineCount; ++line) {
        if (lineCounts[line - 1] > lineCounts[line]) {
          return 1.5;
        }
      }
      return 1;
    })();
    const diff = Math.abs(totalHeight - maxHeight) * bad1 * bad2;

    if (!optimalAttempt || diff < optimalDiff) {
      optimalAttempt = attempts[i];
      optimalDiff = diff;
    }
  }

  const optimalCounts = optimalAttempt!.lineCounts;
  const optimalHeights = optimalAttempt!.heights;
  const rowCount = optimalCounts.length;
  let index = 0;
  let y = 0;
  for (let row = 0; row !== rowCount; ++row) {
    const colCount = optimalCounts[row];
    const lineHeight = optimalHeights[row];
    const height = Math.round(lineHeight);
    let x = 0;

    for (let col = 0; col !== colCount; ++col) {
      const ratio = ratios[index];
      const width = col === colCount - 1 ? maxWidth - x : Math.round(ratio * lineHeight);
      result[index] = {
        x,
        y,
        width,
        height,
      };
      x += width + spacing;
      ++index;
    }
    y += height + spacing;
  }

  return result;
}

function layoutTwo(params: ILayoutParams): AlbumCellRect[] {
  const {
    ratios,
    proportions,
    averageRatio,
  } = params;
  return proportions === 'ww' && averageRatio > 1.4 && ratios[1] - ratios[0] < 0.2
    ? layoutTwoTopBottom(params)
    : (proportions === 'ww' || proportions === 'qq')
      ? layoutTwoLeftRightEqual(params)
      : layoutTwoLeftRight(params);
}

function layoutTwoTopBottom(params: ILayoutParams): AlbumCellRect[] {
  const {
    ratios,
    maxWidth,
    spacing,
    maxHeight,
  } = params;
  const height = Math.round(Math.min(maxWidth / ratios[0], Math.min(maxWidth / ratios[1], (maxHeight - spacing) / 2)));

  return [{
    x: 0,
    y: 0,
    width: maxWidth,
    height,
  }, {
    x: 0,
    y: height + spacing,
    width: maxWidth,
    height,
  }];
}

function layoutTwoLeftRightEqual(params: ILayoutParams): AlbumCellRect[] {
  const {
    ratios,
    maxWidth,
    spacing,
    maxHeight,
  } = params;
  const width = (maxWidth - spacing) / 2;
  const height = Math.round(Math.min(width / ratios[0], Math.min(width / ratios[1], maxHeight)));
  return [{
    x: 0,
    y: 0,
    width,
    height,
  }, {
    x: width + spacing,
    y: 0,
    width,
    height,
  }];
}

function layoutTwoLeftRight(params: ILayoutParams): AlbumCellRect[] {
  const {
    ratios,
    minWidth,
    maxWidth,
    spacing,
    maxHeight,
  } = params;
  const minimalWidth = Math.round(1.5 * minWidth);
  const secondWidth = Math.min(
    Math.round(
      Math.max(
        0.4 * (maxWidth - spacing),
        (maxWidth - spacing) / ratios[0] / (1 / ratios[0] + 1 / ratios[1]),
      ),
    ),
    maxWidth - spacing - minimalWidth,
  );
  const firstWidth = maxWidth - secondWidth - spacing;
  const height = Math.min(maxHeight, Math.round(Math.min(firstWidth / ratios[0], secondWidth / ratios[1])));

  return [{
    x: 0,
    y: 0,
    width: firstWidth,
    height,
  }, {
    x: firstWidth + spacing,
    y: 0,
    width: secondWidth,
    height,
  }];
}

function layoutThree(params: ILayoutParams): AlbumCellRect[] {
  const { proportions } = params;

  return proportions[0] === 'n'
    ? layoutThreeLeftAndOther(params)
    : layoutThreeTopAndOther(params);
}

function layoutThreeLeftAndOther(params: ILayoutParams): AlbumCellRect[] {
  const {
    maxHeight,
    spacing,
    ratios,
    maxWidth,
    minWidth,
  } = params;
  const firstHeight = maxHeight;
  const thirdHeight = Math.round(
    Math.min(
      (maxHeight - spacing) / 2,
      (ratios[1] * (maxWidth - spacing)) / (ratios[2] + ratios[1]),
    ),
  );
  const secondHeight = firstHeight - thirdHeight - spacing;
  const rightWidth = Math.max(
    minWidth,
    Math.round(
      Math.min(
        (maxWidth - spacing) / 2,
        Math.min(
          thirdHeight * ratios[2],
          secondHeight * ratios[1],
        ),
      ),
    ),
  );
  const leftWidth = Math.min(Math.round(firstHeight * ratios[0]), maxWidth - spacing - rightWidth);

  return [{
    x: 0,
    y: 0,
    width: leftWidth,
    height: firstHeight,
  }, {
    x: leftWidth + spacing,
    y: 0,
    width: rightWidth,
    height: secondHeight,
  }, {
    x: leftWidth + spacing,
    y: secondHeight + spacing,
    width: rightWidth,
    height: thirdHeight,
  }];
}

function layoutThreeTopAndOther(params: ILayoutParams): AlbumCellRect[] {
  const {
    maxWidth,
    ratios,
    maxHeight,
    spacing,
  } = params;
  const firstWidth = maxWidth;
  const firstHeight = Math.round(Math.min(firstWidth / ratios[0], 0.66 * (maxHeight - spacing)));
  const secondWidth = (maxWidth - spacing) / 2;
  const secondHeight = Math.min(
    maxHeight - firstHeight - spacing,
    Math.round(Math.min(
      secondWidth / ratios[1],
      secondWidth / ratios[2],
    )),
  );
  const thirdWidth = firstWidth - secondWidth - spacing;

  return [{
    x: 0,
    y: 0,
    width: firstWidth,
    height: firstHeight,
  }, {
    x: 0,
    y: firstHeight + spacing,
    width: secondWidth,
    height: secondHeight,
  }, {
    x: secondWidth + spacing,
    y: firstHeight + spacing,
    width: thirdWidth,
    height: secondHeight,
  }];
}

function layoutFour(params: ILayoutParams): AlbumCellRect[] {
  const { proportions } = params;

  return proportions[0] === 'w'
    ? layoutFourTopAndOther(params)
    : layoutFourLeftAndOther(params);
}

function layoutFourTopAndOther(params: ILayoutParams): AlbumCellRect[] {
  const {
    maxWidth,
    ratios,
    spacing,
    maxHeight,
    minWidth,
  } = params;
  const w = maxWidth;
  const h0 = Math.round(Math.min(w / ratios[0], 0.66 * (maxHeight - spacing)));
  const h = Math.round((maxWidth - 2 * spacing) / (ratios[1] + ratios[2] + ratios[3]));
  const w0 = Math.max(minWidth, Math.round(Math.min(0.4 * (maxWidth - 2 * spacing), h * ratios[1])));
  const w2 = Math.round(Math.max(Math.max(minWidth, 0.33 * (maxWidth - 2 * spacing)), h * ratios[3]));
  const w1 = w - w0 - w2 - 2 * spacing;
  const h1 = Math.min(maxHeight - h0 - spacing, h);

  return [{
    x: 0,
    y: 0,
    width: w,
    height: h0,
  }, {
    x: 0,
    y: h0 + spacing,
    width: w0,
    height: h1,
  }, {
    x: w0 + spacing,
    y: h0 + spacing,
    width: w1,
    height: h1,
  }, {
    x: w0 + spacing + w1 + spacing,
    y: h0 + spacing,
    width: w2,
    height: h1,
  }];
}

function layoutFourLeftAndOther(params: ILayoutParams): AlbumCellRect[] {
  const {
    maxHeight,
    ratios,
    maxWidth,
    spacing,
    minWidth,
  } = params;
  const h = maxHeight;
  const w0 = Math.round(Math.min(h * ratios[0], 0.6 * (maxWidth - spacing)));
  const w = Math.round((maxHeight - 2 * spacing) / (1 / ratios[1] + 1 / ratios[2] + 1 / ratios[3]));
  const h0 = Math.round(w / ratios[1]);
  const h1 = Math.round(w / ratios[2]);
  const h2 = h - h0 - h1 - 2 * spacing;
  const w1 = Math.max(minWidth, Math.min(maxWidth - w0 - spacing, w));

  return [{
    x: 0,
    y: 0,
    width: w0,
    height: h,
  }, {
    x: w0 + spacing,
    y: 0,
    width: w1,
    height: h0,
  }, {
    x: w0 + spacing,
    y: h0 + spacing,
    width: w1,
    height: h1,
  }, {
    x: w0 + spacing,
    y: h0 + h1 + 2 * spacing,
    width: w1,
    height: h2,
  }];
}

export function calculateAlbumLayout(
  ratios: number[],
  maxWidth: number,
  spacing = 2,
): AlbumLayout {
  if (!ratios.length) {
    return { cells: [], width: 0, height: 0 };
  }

  const proportions = getProportions(ratios);
  const averageRatio = getAverageRatio(ratios);
  const albumCount = ratios.length;
  const forceCalc = ratios.some((ratio) => ratio > 2);
  const maxHeight = maxWidth;

  const params: ILayoutParams = {
    ratios,
    proportions,
    averageRatio,
    maxWidth,
    minWidth: 100,
    maxHeight,
    spacing,
  };

  let cells: AlbumCellRect[];
  if (albumCount === 1) {
    cells = layoutSingle(params);
  } else if (albumCount >= 5 || forceCalc) {
    cells = layoutWithComplexLayouter(params);
  } else if (albumCount === 2) {
    cells = layoutTwo(params);
  } else if (albumCount === 3) {
    cells = layoutThree(params);
  } else {
    cells = layoutFour(params);
  }

  let width = 0;
  let height = 0;
  for (const cell of cells) {
    if (cell.x + cell.width > width) width = cell.x + cell.width;
    if (cell.y + cell.height > height) height = cell.y + cell.height;
  }

  return { cells, width, height };
}
