// --- OPTIMIZED LEAST COST PATH ALGORITHM ---
// This version uses multi-resolution approach to prevent timeouts

var cost = ...; // your scalar cost raster (already clipped)
var sourceImage = ...;  // rasterized source point
var destGeom = destinationPoint;  // ee.Geometry.Point

// Step 1: Resample cost raster to coarser resolution for faster computation
var coarseCost = cost.resample('bilinear').reproject({
  crs: cost.projection(),
  scale: 500  // 500m resolution instead of original
});

// Step 2: Compute cumulative cost on coarse raster
var cumulative = coarseCost.cumulativeCost({
  source: sourceImage,
  maxDistance: 50000
});

// Step 3: Trace path with larger steps
var stepSize = 200;  // 200m steps
var maxSteps = 200;  // Reduced iterations
var tolerance = 1.0; // Higher tolerance for convergence

var walk = ee.List.sequence(0, maxSteps).iterate(function(_, prev) {
  prev = ee.Dictionary(prev);
  var lastPoint = ee.Geometry(prev.get('point'));
  var prevList = ee.List(prev.get('path'));
  var lastCost = ee.Number(prev.get('lastCost'));

  // Helper function to safely extract the first value from reduceRegion results
  function getFirstValue(result) {
    return ee.Algorithms.If(
      result.size().gt(0),
      ee.Number(result.get(result.keys().get(0))),
      ee.Number(0)
    );
  }

  // Sample cumulative cost at last point
  var costAtPointResult = cumulative.reduceRegion({
    reducer: ee.Reducer.first(),
    geometry: lastPoint,
    scale: 500,
    maxPixels: 1
  });
  
  var costAtPoint = getFirstValue(costAtPointResult);

  // Early termination conditions
  var reachedSource = ee.Number(costAtPoint).lt(5); // Higher threshold for coarse resolution
  var costStagnant = ee.Algorithms.If(
    lastCost,
    ee.Number(costAtPoint).subtract(lastCost).abs().lt(tolerance),
    false
  );

  // Use only 4 directions for efficiency
  var directions = ee.List([
    [stepSize, 0],    // North
    [stepSize, 90],   // East
    [stepSize, 180],  // South
    [stepSize, 270]   // West
  ]);

  function offsetPoint(lat, lon, distance, bearing) {
    var latOffset = distance.divide(111000);
    var lonOffset = distance.divide(111000).divide(lat.cos());
    var bearingRad = ee.Number(bearing).multiply(ee.Number(Math.PI)).divide(180);
    var dx = lonOffset.multiply(bearingRad.cos());
    var dy = latOffset.multiply(bearingRad.sin());
    var newLat = lat.add(dy);
    var newLon = lon.add(dx);
    return ee.Geometry.Point([newLon, newLat]);
  }

  // Sample neighbors more efficiently
  var neighbors = directions.map(function(offset) {
    offset = ee.List(offset);
    var distance = ee.Number(offset.get(0));
    var bearing = ee.Number(offset.get(1));
    
    var coords = lastPoint.coordinates();
    var lat = ee.Number(coords.get(1));
    var lon = ee.Number(coords.get(0));
    
    var neighbor = offsetPoint(lat, lon, distance, bearing);
    
    // Sample cost at neighbor
    var costResult = cumulative.reduceRegion({
      reducer: ee.Reducer.first(),
      geometry: neighbor,
      scale: 500,
      maxPixels: 1
    });
    
    var cost = getFirstValue(costResult);

    return ee.Dictionary({
      'point': neighbor,
      'cost': cost
    });
  });

  // Find best neighbor
  var best = neighbors.iterate(function(neighbor, acc) {
    neighbor = ee.Dictionary(neighbor);
    acc = ee.Dictionary(acc);
    var neighborCost = ee.Number(neighbor.get('cost'));
    var accCost = ee.Number(acc.get('cost'));
    
    return ee.Algorithms.If(
      neighborCost.lt(accCost),
      neighbor,
      acc
    );
  }, ee.Dictionary({ 'point': lastPoint, 'cost': costAtPoint }));
  
  var bestDict = ee.Dictionary(best);
  var nextPoint = ee.Geometry(bestDict.get('point'));
  var nextCost = ee.Number(bestDict.get('cost'));

  // Stop conditions
  return ee.Algorithms.If(
    reachedSource.or(costStagnant).or(ee.Number(nextCost).gte(costAtPoint)),
    prev,
    ee.Dictionary({
      'point': nextPoint,
      'path': prevList.add(nextPoint),
      'lastCost': costAtPoint
    })
  );
}, ee.Dictionary({ 
  'point': destGeom, 
  'path': ee.List([destGeom]),
  'lastCost': ee.Number(999999)
}));

// Step 4: Create the path
var coarsePath = ee.Geometry.LineString(ee.Dictionary(walk).get('path'));

// Step 5: Optionally refine the path using original resolution
// This is optional and can be commented out if still too slow
var refinedPath = coarsePath; // For now, use coarse path

// Display results
Map.addLayer(coarsePath, {color: 'red', width: 2}, 'Coarse LCP');
Map.addLayer(refinedPath, {color: 'purple', width: 3}, 'Refined LCP');

// Print statistics
var pathLength = ee.List(ee.Dictionary(walk).get('path')).size();
print('Path length (number of points):', pathLength);
print('Step size used:', stepSize, 'meters');
print('Max distance covered:', stepSize.multiply(maxSteps), 'meters'); 