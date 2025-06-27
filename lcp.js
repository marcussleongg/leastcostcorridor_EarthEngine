// --- Step 1: Compute cumulative cost from the source (already done above)
var cost = ...; // your scalar cost raster (already clipped)
var sourceImage = ...;  // rasterized source point
var destGeom = destinationPoint;  // ee.Geometry.Point

var cumulative = cost.cumulativeCost({
  source: sourceImage,
  maxDistance: 50000
});

// --- Step 2: Trace path from destination back to source
var stepSize = 30;  // meters
var pathPoints = ee.List([]);
var maxSteps = 1000;

var start = destGeom;
var step = 0;

var walk = ee.List.sequence(0, maxSteps).iterate(function(_, prev) {
  // Typecast previous value to dictionary
  prev = ee.Dictionary(prev);

  var lastPoint = ee.Geometry(prev.get('point'));
  var prevList = ee.List(prev.get('path'));

  // Sample cumulative cost at last point
  var costAtPointResult = cumulative.reduceRegion({
    reducer: ee.Reducer.first(),
    geometry: lastPoint,
    scale: stepSize,
    maxPixels: 1
  });
  
  // Get the first available band value
  var costAtPoint = ee.Number(0); // Default value
  costAtPoint = ee.Algorithms.If(
    costAtPointResult.size().gt(0), // If the result has any keys
    ee.Number(costAtPointResult.values().get(0)), // Get the first value
    costAtPoint
  );

  // Create 8 surrounding points using bearing angles
  var directions = ee.List([
    [stepSize, 0],    // North
    [stepSize, 45],   // Northeast
    [stepSize, 90],   // East
    [stepSize, 135],  // Southeast
    [stepSize, 180],  // South
    [stepSize, 225],  // Southwest
    [stepSize, 270],  // West
    [stepSize, 315]   // Northwest
  ]);

  // Write function which takes a point and an offset and returns a new point
  function offsetPoint(lat, lon, distance, bearing) {
    // Use a simpler approximation to avoid complex geodesic calculations
    // Convert distance from meters to degrees (approximate)
    var latOffset = distance.divide(111000); // 1 degree ≈ 111,000 meters
    var lonOffset = distance.divide(111000).divide(lat.cos()); // Adjust for latitude
    
    // Convert bearing to x,y offsets
    var bearingRad = ee.Number(bearing).multiply(Math.PI).divide(180);
    var dx = lonOffset.multiply(bearingRad.cos());
    var dy = latOffset.multiply(bearingRad.sin());
    
    // Apply offsets
    var newLat = lat.add(dy);
    var newLon = lon.add(dx);
    
    return ee.Geometry.Point([newLon, newLat]);
  }

  var neighbors = directions.map(function(offset) {
    offset = ee.List(offset);
    var distance = ee.Number(offset.get(0));
    var bearing = ee.Number(offset.get(1));
    
    // Get coordinates of the last point
    var coords = lastPoint.coordinates();
    var lat = ee.Number(coords.get(1));
    var lon = ee.Number(coords.get(0));
    
    // Use the offsetPoint function to create the neighbor
    var neighbor = offsetPoint(lat, lon, distance, bearing);
    
    // Get the cost at one point, that is the neighbor
    var costResult = cumulative.reduceRegion({
      reducer: ee.Reducer.first(),
      geometry: neighbor,
      scale: stepSize,
      maxPixels: 1
    });
    
    // Always ensure we have a valid cost value
    var cost = ee.Number(999999); // Default high cost
    cost = ee.Algorithms.If(
      costResult.size().gt(0), // If the result has any keys
      ee.Number(costResult.values().get(0)), // Get the first value
      cost
    );

    return ee.Dictionary({
      'point': neighbor,
      'cost': cost
    });
  });

  // Choose neighbor with lowest cost - simplified approach
  var best = neighbors.iterate(function(neighbor, acc) {
    neighbor = ee.Dictionary(neighbor);
    acc = ee.Dictionary(acc);
    var neighborCost = ee.Number(neighbor.get('cost'));
    var accCost = ee.Number(acc.get('cost'));
    
    // Ensure both costs are valid numbers before comparison
    var validNeighborCost = ee.Algorithms.If(
      neighborCost,
      neighborCost,
      ee.Number(999999)
    );
    
    var validAccCost = ee.Algorithms.If(
      accCost,
      accCost,
      ee.Number(999999)
    );
    
    // Check if both costs are valid before comparison
    return ee.Algorithms.If(
      ee.Number(validNeighborCost).lt(ee.Number(validAccCost)),
      neighbor,
      acc
    );
  }, ee.Dictionary({ 'point': lastPoint, 'cost': costAtPoint }));
  
  var bestDict = ee.Dictionary(best);
  var nextPoint = ee.Geometry(bestDict.get('point'));
  var nextCost = ee.Number(bestDict.get('cost'));

  // Stop if cost did not decrease (reached source)
  return ee.Algorithms.If(
    nextCost.gte(costAtPoint),
    prev,
    ee.Dictionary({
      'point': nextPoint,
      'path': prevList.add(nextPoint)
    })
  );
}, ee.Dictionary({ 'point': destGeom, 'path': ee.List([destGeom]) }));

// --- Step 3: Convert list of points to a LineString
var pathLine = ee.Geometry.LineString(ee.Dictionary(walk).get('path'));

// --- Step 4: Display
Map.addLayer(pathLine, {color: 'purple'}, 'Least Cost Path');
