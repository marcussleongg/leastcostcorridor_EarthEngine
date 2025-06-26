// Creates cost raster based on Tobler's hiking cost function, capped at 10000
function computeToblersCost (slope, waterMask) {
  // Convert slope to radians
  var slopeInRad = slope.multiply(Math.PI / 180);

  // Apply Tobler's formula
  var landCost = slopeInRad.add(0.05)
    .tan()
    .abs()
    .multiply(-3.5)
    .exp()
    .multiply(6)
    .pow(-1)
    .min(10000);  // cap the Tobler cost itself before combining

  // Apply water mask
  var fullCost = landCost
    .where(waterMask.eq(10000), 10000);  // set cost=10000 where it is water

  return fullCost;
}

// Load DEM and calculate slope
var dem = ee.Image('NASA/NASADEM_HGT/001').select('elevation');
var slope = ee.Terrain.slope(dem);
Map.addLayer(slope, {min: 0, max: 89.99}, 'Slope');
//Map.addLayer(slope, {min: 0, max: 89.99}, 'Slope');

// Quick approximation of land/sea mask purely based on elevation
var landSeaMask = dem.where(dem.lte(0), 10000).where(dem.gt(0), 1);
//Map.addLayer(landSeaMask, {min: 0, max: 10000, palette: ['blue', 'green']}, 'Land/Sea Mask');

// Create cost raster
var tobCost = computeToblersCost(slope, landSeaMask);
print(tobCost);
//Map.addLayer(tobCost, {min: 0, max: 10000, palette: ['white', 'green', 'yellow', 'red']}, 'Cost Surface');


// Converting the point to image
var startPoint = ee.FeatureCollection('projects/ee-poleinikov/assets/scotstart');
Map.addLayer(startPoint, {color: 'blue'}, 'Start Point');
var midPoint = ee.FeatureCollection('projects/ee-poleinikov/assets/scotmid');
Map.addLayer(midPoint, {color: 'blue'}, 'Mid Point');
var endPoint = ee.FeatureCollection('projects/ee-poleinikov/assets/scotend');
Map.addLayer(endPoint, {color: 'blue'}, 'End Point');

var startPointImage = startPoint
  .map(function(f) { return f.set('constant', 1); })  // assign constant value
  .reduceToImage({
    properties: ['constant'],
    reducer: ee.Reducer.first()
  });
  
var midPointImage = midPoint
  .map(function(f) { return f.set('constant', 1); })  // assign constant value
  .reduceToImage({
    properties: ['constant'],
    reducer: ee.Reducer.first()
  });

  
var endPointImage = endPoint
  .map(function(f) { return f.set('constant', 1); })  // assign constant value
  .reduceToImage({
    properties: ['constant'],
    reducer: ee.Reducer.first()
  });
  
// specify region of interest
var roi = startPoint.first().geometry().buffer(35000).bounds();
var clippedCost = tobCost.clip(roi);

// Run cumulative cost function
var cCostFromStart = clippedCost.cumulativeCost(startPointImage, 30000, false)
var cCostFromMid = clippedCost.cumulativeCost(midPointImage, 30000, false)
//var cCostFromEnd = tobCost.cumulativeCost(endPointImage, 30000, false)
//Map.addLayer(cCostFromMid, {min: 0, max: 30000, palette: ['white', 'yellow', 'orange', 'red', 'black']}, 'Cumulative Cost from mid')
//Map.addLayer(cCostFromStart, {min: 0, max: 30000, palette: ['white', 'yellow', 'orange', 'red', 'black']}, 'Cumulative Cost from start')
//Map.addLayer(cCostFromEnd, {min: 0, max: 30000, palette: ['white', 'yellow', 'orange', 'red', 'black']}, 'Cumulative Cost from end')

// Add the two cumulative cost rasters
// var addedCost = cCostFromStart.add(cCostFromEnd);
var addedCost = cCostFromStart.add(cCostFromMid).clip(roi);

// Declare how much to scale up the raster by to increase computation speed
// This appears to have the largest impact on computation time
var scale_up = 3;

// Find the minimum cost from addedCost raster
var minCostDict = addedCost.reduceRegion({
  // reducer being min means we are getting the minimum from all pixels in addedCost
  reducer: ee.Reducer.min(),
  geometry: clippedCost.geometry(),
  scale: 30 * scale_up,  // using a coarser scale for better speed
  maxPixels: 1e13,
  // if too many pixels at given scale, bestEffort uses a larger scale to ensure function runs successfully
  bestEffort: true
});

var minCost = ee.Number(minCostDict.get('cumulative_cost'));

// Get pixels in LCC by selecting those with cost ≤ minCost + threshold
// tolerance has same units as cost, which is derived from Tobler's hiking function
var tolerance = 1;
var leastCostCorridor = addedCost.lte(minCost.add(tolerance));

// Convert the raster path to a vector. This is more robust for visualization.
var pathVector = leastCostCorridor.selfMask().reduceToVectors({
  geometry: clippedCost.geometry(),
  scale: 30 * scale_up,
  geometryType: 'polygon',
  eightConnected: true,
  bestEffort: true
});

print(pathVector)

// Style the vector path to be a thick, bright red line.
var styledPath = pathVector.style({
  color: 'FF0000', // Bright red
  width: 3       // Line width in pixels
});

// Add the styled path to the map.
Map.addLayer(styledPath, {}, 'Least-Cost Path (Styled Vector)');
//Map.addLayer(corridor.selfMask(), {palette: ['red']}, 'Least Cost Corridor');
//Map.centerObject(styledPath, 18)

Export.table.toDrive({
  collection: pathVector,
  description: 'lcc_export',
  fileFormat: 'SHP'
});
