// --- Step 1: Compute cumulative cost from the source (already done above)
var cost = ...; // your scalar cost raster (already clipped)
var sourceImage = ...;  // rasterized source point
var destGeom = destinationPoint;  // ee.Geometry.Point

// Declare how much to scale up the raster by to increase computation speed
// This appears to have the largest impact on computation time
var scale_up = 3;

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
    scale: 30 * scale_up
  }).values().get(0);
  
  // Better source detection - check if cost is very low (near source)
  var atSource = ee.Algorithms.If(
    costAtLastPoint,
    ee.Number(costAtLastPoint).lt(5), // Consider "at source" if cost < 5
    false
  );

  // Use the pre-calculated neighborhood image to find the neighbor costs.
  // This is a very cheap "lookup" operation.
  var costs = costNeighborhood.reduceRegion({
    reducer: ee.Reducer.first(),
    geometry: lastPoint,
    scale: 30 * scale_up
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
  // The band names are in format 'cumulative_cost_row_col' where row and col are offsets
  var parts = ee.String(nextDirection).split('_');
  var dRow = ee.Algorithms.If(
    parts.length().gt(3),
    ee.Number.parse(parts.get(2)), // Row offset (-1, 0, or 1)
    0  // Default to no movement if parsing fails
  );
  var dCol = ee.Algorithms.If(
    parts.length().gt(3),
    ee.Number.parse(parts.get(3)), // Col offset (-1, 0, or 1)
    0  // Default to no movement if parsing fails
  );
  
  // Use the actual pixel size from the cost surface
  var costProjection = cumulative.projection();
  var pixelSizeMeters = ee.Algorithms.If(
    costProjection.nominalScale(),
    costProjection.nominalScale(),
    30  // fallback to 30m if nominalScale is null
  );
  
  // Apply the scale_up factor to the pixel size
  var scaledPixelSizeMeters = ee.Number(pixelSizeMeters).multiply(scale_up);
  
  var currentCoords = lastPoint.coordinates();
  
  // Convert pixel size from meters to degrees
  // At latitude 58°, 1 degree longitude ≈ 58,660 meters, 1 degree latitude ≈ 111,320 meters
  var metersPerDegreeLat = 111320;
  var metersPerDegreeLon = 111320 * Math.cos(58 * Math.PI / 180); // at latitude 58°
  
  var pixelSizeLon = ee.Number(scaledPixelSizeMeters).divide(metersPerDegreeLon);
  var pixelSizeLat = ee.Number(scaledPixelSizeMeters).divide(metersPerDegreeLat);
  
  // Calculate new coordinates with proper degree offsets
  var newX = ee.Number(currentCoords.get(0)).add(ee.Number(dCol).multiply(pixelSizeLon));
  var newY = ee.Number(currentCoords.get(1)).subtract(ee.Number(dRow).multiply(pixelSizeLat));

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
  // Also stop if we can't get a valid cost (meaning we're outside the cost surface)
  var shouldStop = ee.Algorithms.If(
    costAtLastPoint,
    atSource, // Stop if at source
    true      // Stop if cost is null (outside cost surface)
  );
  
  return ee.Algorithms.If(shouldStop, previousPath, previousPath.add(nextPointCoords));
}, initialPath);


// --- Step 4: Convert list of points to a LineString
// Debug: First, let's examine what we have in the path using proper Earth Engine methods
print('Path object:', path);
print('First path element:', ee.List(path).get(0));
print('Second path element:', ee.List(path).get(1));
print('Third path element:', ee.List(path).get(2));

// Check if destination is within cost surface bounds
var destCost = cumulative.reduceRegion({
  reducer: ee.Reducer.first(),
  geometry: destGeom,
  scale: 30 * scale_up
}).values().get(0);

print('Cost at destination point:', destCost);
print('Destination point valid (not null):', destCost);

// Debug: Examine the neighborhood structure at the destination point
var neighborhoodSample = costNeighborhood.reduceRegion({
  reducer: ee.Reducer.first(),
  geometry: destGeom,
  scale: 30 * scale_up
});

print('Neighborhood structure at destination:', neighborhoodSample);
print('Neighborhood band names:', neighborhoodSample.keys());

// Debug: Check what direction is being chosen at the destination
var destNeighborhoodCosts = costNeighborhood.reduceRegion({
  reducer: ee.Reducer.first(),
  geometry: destGeom,
  scale: 30 * scale_up
});

var destMinCost = destNeighborhoodCosts.values().reduce(ee.Reducer.min());
var destMinIndex = destNeighborhoodCosts.values().indexOf(destMinCost);
var destChosenDirection = ee.List(destNeighborhoodCosts.keys()).get(destMinIndex);

print('Destination neighborhood costs:', destNeighborhoodCosts);
print('Destination minimum cost:', destMinCost);
print('Destination chosen direction:', destChosenDirection);

// Debug: Show the actual coordinate movement calculation
var destParts = ee.String(destChosenDirection).split('_');
var destDRow = ee.Number.parse(destParts.get(2));
var destDCol = ee.Number.parse(destParts.get(3));

print('Destination direction parsing:');
print('  Row offset:', destDRow);
print('  Col offset:', destDCol);

// Calculate what the step should be
var destPixelSizeMeters = ee.Number(30.92).multiply(scale_up);
var destMetersPerDegreeLat = 111320;
var destMetersPerDegreeLon = 111320 * Math.cos(58 * Math.PI / 180);
var destPixelSizeLon = destPixelSizeMeters.divide(destMetersPerDegreeLon);
var destPixelSizeLat = destPixelSizeMeters.divide(destMetersPerDegreeLat);

var destStepLon = ee.Number(destDCol).multiply(destPixelSizeLon);
var destStepLat = ee.Number(destDRow).multiply(destPixelSizeLat);

print('Step calculation:');
print('  Pixel size (meters):', destPixelSizeMeters);
print('  Step in longitude (degrees):', destStepLon);
print('  Step in latitude (degrees):', destStepLat);

// Get the bounds of the cost surface
var costBounds = cumulative.geometry().bounds();
print('Cost surface bounds:', costBounds);

// Check if destination is within the cost surface bounds
var destInBounds = costBounds.contains(destGeom);
print('Destination within cost surface bounds:', destInBounds);

// Check what happened at the second point (where the algorithm stopped)
var secondPoint = ee.Geometry.Point(ee.List(path).get(1));
var secondPointCost = cumulative.reduceRegion({
  reducer: ee.Reducer.first(),
  geometry: secondPoint,
  scale: 30 * scale_up
}).values().get(0);

print('Cost at second point:', secondPointCost);
print('Second point valid (not null):', secondPointCost);

// Check if the second point is within bounds
var secondPointInBounds = costBounds.contains(secondPoint);
print('Second point within cost surface bounds:', secondPointInBounds);

// Check if the algorithm stopped because it thinks it reached the source
var isNearSource = ee.Algorithms.If(
  secondPointCost,
  ee.Number(secondPointCost).lt(5), // Same threshold as in the algorithm
  false
);
print('Second point near source (cost < 5):', isNearSource);

// Check the distance between destination and second point
var destCoords = destGeom.coordinates();
var secondCoords = secondPoint.coordinates();
var distance = ee.Geometry.Point(destCoords).distance(ee.Geometry.Point(secondCoords));
print('Distance from destination to second point (meters):', distance);

// Debug the coordinate calculation
print('Destination coordinates:', destCoords);
print('Second point coordinates:', secondCoords);

// Calculate what the step should have been
var expectedStepX = ee.Number(destCoords.get(0)).subtract(ee.Number(secondCoords.get(0)));
var expectedStepY = ee.Number(destCoords.get(1)).subtract(ee.Number(secondCoords.get(1)));
print('Actual step in X direction (degrees):', expectedStepX);
print('Actual step in Y direction (degrees):', expectedStepY);

// Convert to meters (approximate)
var metersPerDegreeLat = 111320; // meters per degree latitude
var metersPerDegreeLon = 111320 * Math.cos(58 * Math.PI / 180); // at latitude 58°
var stepXMeters = ee.Number(expectedStepX).multiply(metersPerDegreeLon);
var stepYMeters = ee.Number(expectedStepY).multiply(metersPerDegreeLat);
print('Actual step in X direction (meters):', stepXMeters);
print('Actual step in Y direction (meters):', stepYMeters);

// Get the actual pixel size from the cost surface
var costProjection = cumulative.projection();
var nominalScale = costProjection.nominalScale();
print('Cost surface nominal scale (meters):', nominalScale);

// Check if we should use the actual scale instead of assuming 30m
var actualPixelSize = ee.Algorithms.If(
  nominalScale,
  nominalScale,
  30  // fallback to 30m if nominalScale is null
);
print('Using pixel size (meters):', actualPixelSize);

// Calculate what the step size should be in degrees
var metersPerDegreeLat = 111320;
var metersPerDegreeLon = 111320 * Math.cos(58 * Math.PI / 180);
var scaledActualPixelSize = ee.Number(actualPixelSize).multiply(scale_up);
var stepSizeLonDegrees = ee.Number(scaledActualPixelSize).divide(metersPerDegreeLon);
var stepSizeLatDegrees = ee.Number(scaledActualPixelSize).divide(metersPerDegreeLat);
print('Expected step size in longitude (degrees):', stepSizeLonDegrees);
print('Expected step size in latitude (degrees):', stepSizeLatDegrees);

// Check if the path is actually reaching low cost areas (near source)
var lastElement = ee.List(path).get(-1);
var lastPoint = ee.Geometry.Point(lastElement);
var finalCost = cumulative.reduceRegion({
  reducer: ee.Reducer.first(),
  geometry: lastPoint,
  scale: 30 * scale_up
}).values().get(0);

print('Cost at final point:', finalCost);
print('Cost at starting point:', cumulative.reduceRegion({
  reducer: ee.Reducer.first(),
  geometry: destGeom,
  scale: 30 * scale_up
}).values().get(0));

// Debug: Check if the path is actually moving toward lower costs
var pathLength = ee.List(path).length();
print('Path length:', pathLength);

// Sample costs at different points along the path
var costAtStart = cumulative.reduceRegion({
  reducer: ee.Reducer.first(),
  geometry: ee.Geometry.Point(ee.List(path).get(0)),
  scale: 30 * scale_up
}).values().get(0);

var costAtQuarter = ee.Algorithms.If(
  pathLength.gt(6),
  cumulative.reduceRegion({
    reducer: ee.Reducer.first(),
    geometry: ee.Geometry.Point(ee.List(path).get(6)),
    scale: 30 * scale_up
  }).values().get(0),
  'Path too short'
);

var costAtHalf = ee.Algorithms.If(
  pathLength.gt(12),
  cumulative.reduceRegion({
    reducer: ee.Reducer.first(),
    geometry: ee.Geometry.Point(ee.List(path).get(12)),
    scale: 30 * scale_up
  }).values().get(0),
  'Path too short'
);

print('Cost progression - Start:', costAtStart, 'Quarter:', costAtQuarter, 'Half:', costAtHalf, 'End:', finalCost);

// Check if the final point is near the boundary
var finalPointInBounds = costBounds.contains(lastPoint);
print('Final point within cost surface bounds:', finalPointInBounds);

// Check the distance from final point to boundary
var finalCoords = lastPoint.coordinates();
print('Final point coordinates:', finalCoords);

// Get the bounds coordinates for comparison
print('Cost surface bounds:', costBounds);

// Check if final point coordinates are within the bounds
var finalLon = ee.Number(finalCoords.get(0));
var finalLat = ee.Number(finalCoords.get(1));

print('Final point coordinates:', finalCoords);
print('Final longitude:', finalLon);
print('Final latitude:', finalLat);

// Calculate total distance traveled
var totalDistance = ee.Geometry.Point(destCoords).distance(lastPoint);
print('Total distance traveled (meters):', totalDistance);

// Since we're now storing coordinate lists directly, we can use them as-is
var pathLine = ee.Geometry.LineString(path);

// --- Step 5: Display
Map.addLayer(cumulative, {min: 0, max: 50000, palette: ['blue', 'green', 'yellow', 'red']}, 'Cumulative Cost Surface');
Map.addLayer(pathLine, {color: 'FF0000', width: 2}, 'Least Cost Path (Efficient)');

// Print path details for debugging
print('Number of steps in path:', ee.List(path).length());