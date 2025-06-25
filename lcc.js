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
var endPoint = ee.FeatureCollection('projects/ee-poleinikov/assets/scotend');
Map.addLayer(endPoint, {color: 'blue'}, 'End Point');

var startPointImage = startPoint
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

// Run cumulative cost function
var cCostFromStart = tobCost.cumulativeCost(startPointImage, 60000, false)
Map.addLayer(cCostFromStart, {min: 0, max: 60000, palette: ['white', 'yellow', 'orange', 'red', 'black']}, 'Cumulative Cost from start')
var cCostFromEnd = tobCost.cumulativeCost(endPointImage, 60000, false)
Map.addLayer(cCostFromEnd, {min: 0, max: 60000, palette: ['white', 'yellow', 'orange', 'red', 'black']}, 'Cumulative Cost from end')

// Add the two cumulative cost rasters
var addedCost = cCostFromStart.add(cCostFromEnd);

// Find the minimum cost from start to end, vice-versa
var minTotalCost = addedCost.reduceRegion({
  reducer: ee.Reducer.min(),
  geometry: tobCost.geometry(),
  scale: 30,  // use your cost raster scale
  maxPixels: 1e13
}).get('sum');

// Extract LCC by applying a threshold
var tolerance = 0.10;
var threshold = ee.Number(minTotalCost).multiply(1 + tolerance);
var corridor = addedCost.lte(threshold);

// Visualize the LCC
Map.addLayer(corridor.selfMask(), {palette: ['blue']}, 'Least Cost Corridor');