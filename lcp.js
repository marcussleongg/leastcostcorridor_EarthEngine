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
  var costAtPoint = cumulative.sample({
    region: lastPoint,
    scale: stepSize,
    numPixels: 1
  }).first().getNumber('sum');

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
    var R = ee.Number(6378137);  // Radius of Earth in meters
    var brng = ee.Number(bearing).multiply(Math.PI).divide(180); // to radians
    var lat1 = ee.Number(lat).multiply(Math.PI).divide(180);
    var lon1 = ee.Number(lon).multiply(Math.PI).divide(180);
    
    // Convert distance to Earth Engine number
    var d = ee.Number(distance);
    var dR = d.divide(R); // distance / radius as ee.Number
  
    var lat2 = lat1.sin().multiply(dR.cos()).multiply(brng.cos()).add(lat1.cos().multiply(dR.cos())).asin();
    var lon2 = lon1.add(
      brng.sin().multiply(dR).multiply(lat1.cos())
      .atan2(dR.cos().subtract(lat1.sin().multiply(lat2.sin())))
    );
  
    return ee.Geometry.Point([
      lon2.multiply(180).divide(Math.PI),
      lat2.multiply(180).divide(Math.PI)
    ]);
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
    var cost = cumulative.sample({
      region: neighbor,
      scale: stepSize,
      numPixels: 1
    }).first().getNumber('sum');

    return ee.Dictionary({
      'point': neighbor,
      'cost': cost
    });
  });

  // Choose neighbor with lowest cost
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
  }, ee.Dictionary({ 'point': ee.Geometry.Point([0, 0]), 'cost': ee.Number(999999) }));
  print(best);
  var nextPoint = ee.Geometry(best.get('point'));
  var nextCost = ee.Number(best.get('cost'));

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
