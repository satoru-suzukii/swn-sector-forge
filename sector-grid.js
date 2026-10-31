/* Sector Forge grid configuration. Keep dimensions in one place so generation,
 * validation, map rendering, and imported sectors use the same coordinates. */
var SectorGrid = (function() {
  var DEFAULT_COLUMNS = 10;
  var DEFAULT_ROWS = 12;
  var MIN_COLUMNS = 5;
  var MAX_COLUMNS = 20;
  var MIN_ROWS = 5;
  var MAX_ROWS = 20;

  function dimensions(sector) {
    var grid = sector && sector.grid ? sector.grid : {};
    var columns = Number(grid.columns);
    var rows = Number(grid.rows);
    if (!Number.isInteger(columns) || columns < MIN_COLUMNS || columns > MAX_COLUMNS) columns = DEFAULT_COLUMNS;
    if (!Number.isInteger(rows) || rows < MIN_ROWS || rows > MAX_ROWS) rows = DEFAULT_ROWS;
    return {columns: columns, rows: rows};
  }

  function validCoordinates(sector, x, y) {
    var size = dimensions(sector);
    return Number.isInteger(Number(x)) && Number.isInteger(Number(y)) &&
      Number(x) >= 0 && Number(x) < size.columns &&
      Number(y) >= 0 && Number(y) < size.rows;
  }

  function viewport(sector) {
    var size = dimensions(sector);
    // These dimensions leave room for the hex radius, edge labels and footer stamp.
    var width = Math.ceil(Math.max(640, 40 + (size.columns - 1) * 58.5 + 39 + 35));
    var height = Math.ceil(Math.max(880, 35 + (size.rows - 0.5) * 67.55 + 39 + 30));
    return {width: width, height: height, columns: size.columns, rows: size.rows};
  }

  return {
    DEFAULT_COLUMNS: DEFAULT_COLUMNS,
    DEFAULT_ROWS: DEFAULT_ROWS,
    MIN_COLUMNS: MIN_COLUMNS,
    MAX_COLUMNS: MAX_COLUMNS,
    MIN_ROWS: MIN_ROWS,
    MAX_ROWS: MAX_ROWS,
    dimensions: dimensions,
    validCoordinates: validCoordinates,
    viewport: viewport
  };
})();
