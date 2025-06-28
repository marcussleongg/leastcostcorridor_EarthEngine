// --- Step 1: Compute cumulative cost from the source (already done above)
var cost = ...; // your scalar cost raster (already clipped)
var sourceImage = ...;  // rasterized source point
var destGeom = destinationPoint;  // ee.Geometry.Point

// Optimize the cumulative cost computation
var cumulative = cost.cumulativeCost({
  source: sourceImage,
  maxDistance: 50000
});

// --- Step 2: Pre-calculate a neighborhood "lookup" image
// Define a 3x3 pixel kernel.
var kernel = ee.Kernel.square(1, 'pixels');

// Create an image where each band contains the cost of a neighbor.
// This is a single, efficient, parallel operation.
var costNeighborhood = cumulative.neighborhoodToBands(kernel);


// --- Step 3: Iteratively trace the path from destination to source
var maxSteps = 300; // Define max number of steps to prevent infinite loops
var startPoint = destGeom;

// This is the initial list of points for our path. It starts with the destination coordinates.
var initialPath = ee.List([startPoint.coordinates()]);

// The iterative function to find the path.
var path = ee.List.sequence(1, maxSteps).iterate(function(i, previousPath) {
  previousPath = ee.List(previousPath);
  var lastPointCoords = previousPath.get(-1);
  var lastPoint = ee.Geometry.Point(lastPointCoords);

  // Check if we have reached the source (or are very close).
  // A cost of 0 means we are at the source pixel.
  var costAtLastPoint = cumulative.reduceRegion({
    reducer: ee.Reducer.first(),
    geometry: lastPoint,
    scale: 30
  }).values().get(0);
  
  // Add null checking to prevent the error
  var atSource = ee.Algorithms.If(
    costAtLastPoint,
    ee.Number(costAtLastPoint).eq(0),
    false  // If costAtLastPoint is null, we're not at source
  );

  // Use the pre-calculated neighborhood image to find the neighbor costs.
  // This is a very cheap "lookup" operation.
  var costs = costNeighborhood.reduceRegion({
    reducer: ee.Reducer.first(),
    geometry: lastPoint,
    scale: 30
  });

  // Find the direction (band name) corresponding to the minimum cost.
  var minCost = costs.values().reduce(ee.Reducer.min());
  
  // Add null checking to prevent indexOf error
  var nextPixelIndex = ee.Algorithms.If(
    minCost,
    costs.values().indexOf(minCost),
    0  // Default to first element if minCost is null
  );
  
  var nextDirection = ee.List(costs.keys()).get(nextPixelIndex);
  
  // Calculate the coordinates of the next point based on the chosen direction.
  // The band names '..._1_0' etc., correspond to row/column offsets.
  var parts = ee.String(nextDirection).split('_');
  var dRow = ee.Number.parse(parts.get(2)).subtract(1); // Row offset (-1, 0, or 1)
  var dCol = ee.Number.parse(parts.get(3)).subtract(1); // Col offset (-1, 0, or 1)
  
  var proj = cumulative.projection();
  var currentCoords = lastPoint.transform(proj).coordinates();
  var newX = ee.Number(currentCoords.get(0)).add(ee.Number(dCol).multiply(proj.nominalScale()));
  var newY = ee.Number(currentCoords.get(1)).subtract(ee.Number(dRow).multiply(proj.nominalScale()));

  // Validate that coordinates are valid numbers using Earth Engine methods
  // Check that coordinates are not null and are reasonable values
  var isValidX = newX.and(newX.gt(-180).and(newX.lt(180)));  // Valid longitude range
  var isValidY = newY.and(newY.gt(-90).and(newY.lt(90)));    // Valid latitude range
  var bothValid = isValidX.and(isValidY);
  
  // Create the new point coordinates only if they are valid
  var nextPointCoords = ee.Algorithms.If(
    bothValid,
    [newX, newY],
    lastPointCoords  // Use previous coordinates if new ones are invalid
  );

  // If at the source, stop. Otherwise, add the new point coordinates to the path.
  return ee.Algorithms.If(atSource, previousPath, previousPath.add(nextPointCoords));
}, initialPath);


// --- Step 4: Convert list of points to a LineString
// Debug: First, let's examine what we have in the path using proper Earth Engine methods
print('Path object:', path);
print('First path element:', ee.List(path).get(0));

// Since we're now storing coordinate lists directly, we can use them as-is
var pathLine = ee.Geometry.LineString(path);

// --- Step 5: Display
Map.addLayer(pathLine, {color: 'FF0000', width: 2}, 'Least Cost Path (Efficient)');

// Print path details for debugging
print('Number of steps in path:', ee.List(path).length());