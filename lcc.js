// Array of ALL points as [longitude, latitude] tuples
// The algorithm will automatically find the two points furthest apart to use as start/end
var all_points_coords = [
  [11.3433660186036, 44.5037205375293],
  [9.18917709156214, 45.4658836780192],
  [11.0526954912152, 44.595602489102],
  [9.32018746590149, 45.3553880723531],
  [10.9251527123913, 44.6470689132215],
  [10.7790069173826, 44.6540878517765],
  [10.6298059531519, 44.6989918768963],
  [10.3254918017869, 44.8017940139929],
  [9.69696430808572, 45.0513627103219],
  [9.5029900028069, 45.311166366664]
];

// Check that there are at least 2 points
if (all_points_coords.length < 2) {
  print('ERROR: At least 2 points are required in the all_points_coords array!');
  throw new Error('Insufficient points: ' + all_points_coords.length + ' points provided, minimum 2 required.');
}

// Function to find the two points that are furthest apart
function findFurthestPoints(points_coords) {
  // Create all possible pairs of points with their indices
  var point_pairs = points_coords.map(function(coord1, i) {
    return points_coords.slice(i + 1).map(function(coord2, j) {
      var point1_geom = ee.Geometry.Point(coord1[0], coord1[1]);
      var point2_geom = ee.Geometry.Point(coord2[0], coord2[1]);
      var distance = point1_geom.distance({'right': point2_geom, 'maxError': 1}).getInfo();
      
      return {
        start_idx: i,
        end_idx: i + j + 1,
        distance: distance,
        start_coords: coord1,
        end_coords: coord2
      };
    });
  }).reduce(function(flat, pair_array) {
    return flat.concat(pair_array);
  }, []); // Flatten the nested arrays
  
  // Find the pair with maximum distance
  var furthest_pair = point_pairs.reduce(function(max_pair, current_pair) {
    return current_pair.distance > max_pair.distance ? current_pair : max_pair;
  });
  
  return furthest_pair;
}

// Function to determine start/end points and extract intermediates
function processPointArray(all_points_coords) {
  // Find furthest apart points
  var furthest_pair = findFurthestPoints(all_points_coords);
  
  // Extract start and end points
  var start_point_geom = ee.Geometry.Point(all_points_coords[furthest_pair.start_idx][0], all_points_coords[furthest_pair.start_idx][1]);
  var end_point_geom = ee.Geometry.Point(all_points_coords[furthest_pair.end_idx][0], all_points_coords[furthest_pair.end_idx][1]);
  
  // Get intermediate points (all points except start and end)
  var intermediate_coords = [];
  for (var i = 0; i < all_points_coords.length; i++) {
    if (i !== furthest_pair.start_idx && i !== furthest_pair.end_idx) {
      intermediate_coords.push(all_points_coords[i]);
    }
  }
  
  return {
    start_geom: start_point_geom,
    end_geom: end_point_geom,
    intermediate_coords: intermediate_coords
  };
}

// Process the point array to determine start/end and intermediates
var point_data = processPointArray(all_points_coords);
var start_point_geom = point_data.start_geom;
var end_point_geom = point_data.end_geom;
var intermediate_points_coords = point_data.intermediate_coords;

// Create FeatureCollections
var start_point = ee.FeatureCollection(start_point_geom);
var end_point = ee.FeatureCollection(end_point_geom);

Map.centerObject(start_point, 8);

// Time taken for script to complete is dependent on the downsampling and tolerance parameters
// They are also affected by the number of progressive refinement rounds
// Points further apart may see the script fail to complete due to GEE's memory limits
// Increase downsampling multiplier/initial downsampling and lcc_rounds for greatest runtime reduction

// Number of progressive refinement rounds for LCC
var lcc_rounds = 3;
// Tolerance for acceptance in LCC
var initial_tolerance_percentage = 0.05;
// Initial downsampling of cost raster for LCC to allow for faster computation
var initial_downsample = 50;
// Tolerance multiplier for each subsequent round of LCC
var tolerance_multiplier = 0.005;
// Downsampling multiplier for each subsequent round of LCC
var downsample_multiplier = 0.5;
// Controls how "flat" an area must be to be included for convolution edge detection
var low_gradient_threshold = 0.02;
// Cushion for ROI area (1.1 = 10% cushion)
var roi_cushion = 1.1;
// Percentage (0-256) threshold of water occurrence to be considered surface water body
var water_mask_threshold = 90;

// Color of the corridor
var corridor_color = '#17ff00';
// Color of the low gradient areas within the corridor
var low_gradient_color = '#F5EF42';
// Width of the corridor in pixels (note that this is simply a visual parameter for the polygon output)
var corridor_width = 3;

// Creates cost raster based on cost function, capped at 10000
function computeCost (slope, water_mask) {
  // Anaya Hernandez method
  var slope_squared = slope.pow(2);
  var land_cost = slope_squared.multiply(0.031)
                  .add(slope.multiply(-0.025))
                  .add(1)
                  .min(10000);  // cap the cost itself before combining
  
  // Tobler's hiking function
  // Convert slope to radians
  //var slopeInRad = slope.multiply(Math.PI / 180);

  // Apply Tobler's formula
  //var landCost = slopeInRad.add(0.05)
  //  .tan()
  //  .abs()
  //  .multiply(-3.5)
  //  .exp()
  //  .multiply(6)
  //  .pow(-1)
  //  .min(10000);  // cap the Tobler cost itself before combining

  // Apply water mask
  var full_cost = land_cost
    .where(water_mask.eq(1), 10000);  // set cost=10000 where it is water

  return full_cost;
}

// Load DEM and calculate slope
var dem = ee.Image('NASA/NASADEM_HGT/001').select('elevation');
var slope = ee.Terrain.slope(dem);
Map.addLayer(slope, {min: 0, max: 89.99}, 'Slope');

var gsw = ee.Image("JRC/GSW1_4/GlobalSurfaceWater");
var occurrence = gsw.select('occurrence');
// Create a water mask layer
var water_mask = occurrence.gt(water_mask_threshold).unmask(0);

// IF to use quick approximation of land/sea mask purely based on elevation
//var landSeaMask = dem.where(dem.lte(0), 10000).where(dem.gt(0), 1);
//Map.addLayer(landSeaMask, {min: 0, max: 10000, palette: ['blue', 'green']}, 'Land/Sea Mask');

// Radius to be considered ROI with cushion
var roi_radius = start_point_geom.distance({'right':end_point_geom, 'maxError': 1}).multiply(roi_cushion);

// Create cost raster
var cost_raster = computeCost(slope, water_mask);
// specify region of interest
var roi = start_point.first().geometry().buffer(roi_radius).bounds();
var clipped_cost = cost_raster.clip(roi);
Map.addLayer(roi, {color: 'purple'}, 'ROI');

// Perform least cost corridor search with dynamic number of progressive refinement rounds
function leastCostCorridor(start_point, end_point, num_rounds) {
  num_rounds = num_rounds || lcc_rounds; // Use default if not specified
  
  var start_point_image = start_point
  .map(function(f) { return f.set('constant', 1); }) // assign constant value
  .reduceToImage({
    properties: ['constant'],
    reducer: ee.Reducer.first()
  });

  var end_point_image = end_point
  .map(function(f) { return f.set('constant', 1); }) // assign constant value
  .reduceToImage({
    properties: ['constant'],
    reducer: ee.Reducer.first()
  });

  // Run cumulative cost function
  var c_cost_from_start = clipped_cost.cumulativeCost(start_point_image, roi_radius, false);
  var c_cost_from_end = clipped_cost.cumulativeCost(end_point_image, roi_radius, false);

  // Add the two cumulative cost rasters
  var current_added_cost = c_cost_from_start.add(c_cost_from_end).clip(roi);
  var current_path_vector = null;
  var current_downsample = initial_downsample;
  var current_tolerance = null;

  // Progressive refinement loop
  for (var round = 1; round <= num_rounds; round++) {
    // If not first round, clip to previous path vector
    if (current_path_vector !== null) {
      current_added_cost = current_added_cost.clip(current_path_vector);
    }

    // Find minimum cost for current round
    var min_cost_dict = current_added_cost.reduceRegion({
      reducer: ee.Reducer.min(),
      geometry: current_added_cost.geometry(),
      scale: 30 * current_downsample,
      maxPixels: 1e13,
      bestEffort: true
    });

    var min_cost = ee.Number(min_cost_dict.get('cumulative_cost'));

    // Calculate tolerance for current round
    if (round === 1) {
      current_tolerance = min_cost.multiply(initial_tolerance_percentage);
    } else {
      current_tolerance = current_tolerance.multiply(tolerance_multiplier);
    }

    // Create least cost corridor
    var least_cost_corridor = current_added_cost.lte(min_cost.add(current_tolerance));

    // Convert to vector
    current_path_vector = least_cost_corridor.selfMask().reduceToVectors({
      geometry: round === 1 ? clipped_cost.geometry() : current_added_cost.geometry(),
      scale: 30 * current_downsample,
      geometryType: 'polygon',
      eightConnected: true,
      bestEffort: true
    });

    // Update downsample for next round
    current_downsample = current_downsample * downsample_multiplier;
  }

  return current_path_vector;
}

function convolutionEdgeDetection(cost_raster, path_vector) {
  // Convolution edge detection
  // Perform edge detection on entire cost raster (unable to do this on the final path vector) to find sharp elevation changes
  var laplacian = ee.Kernel.laplacian8({ normalize: false });
  var edges = cost_raster.clip(path_vector).convolve(laplacian);
  // Take the absolute value. High values are now edges/slopes, values near zero are flat
  var abs_edges = edges.abs();
  // Filter for low gradient points. We select pixels where the edge value is less than the threshold
  var low_gradient_areas = abs_edges.lte(low_gradient_threshold).selfMask();
  return low_gradient_areas;
}

function addPathLayers(path_vector, low_gradient_areas_within_path, label, corridor_color, corridor_width, low_gradient_color) {
  var start_end_styled_path = path_vector.style({
  color: corridor_color,
  width: corridor_width
  });
  
  Map.addLayer(start_end_styled_path, {}, 'Least Cost Corridor ' + label);
  Map.addLayer(low_gradient_areas_within_path, {palette: [low_gradient_color]}, 'Low Gradient Areas in Corridor ' + label);
}

// Function to sort points by distance from start point
function sortPointsByDistance(points_coords, start_geom) {
  var points_with_distance = points_coords.map(function(coord) {
    var point_geom = ee.Geometry.Point(coord[0], coord[1]);
    var distance = start_geom.distance({'right': point_geom, 'maxError': 1});
    return {
      coords: coord,
      geometry: point_geom,
      distance: distance
    };
  });
  
  // Sort by distance (closest to start first)
  points_with_distance.sort(function(a, b) {
    return a.distance.getInfo() - b.distance.getInfo();
  });
  
  return points_with_distance;
}

// Function to process all segments and add them to map
function processAllSegments(start_geom, end_geom, intermediate_coords, show_segments) {
  show_segments = show_segments !== undefined ? show_segments : false;
  
  var start_fc = ee.FeatureCollection(start_geom);
  var end_fc = ee.FeatureCollection(end_geom);
  
  // Sort intermediate points by distance from start
  var sorted_points = sortPointsByDistance(intermediate_coords, start_geom);
  
  // Create feature collections for sorted points
  var sorted_point_fcs = sorted_points.map(function(point_data) {
    return ee.FeatureCollection(point_data.geometry);
  });
  
  // Process segments if requested
  if (show_segments) {
    var all_points = [start_fc].concat(sorted_point_fcs).concat([end_fc]);
    
    // Create corridors between consecutive points
    for (var j = 0; j < all_points.length - 1; j++) {
      var segment_start = all_points[j];
      var segment_end = all_points[j + 1];
      
      var segment_label = j === 0 ? 'Start-1' : 
                         j === all_points.length - 2 ? (j) + '-End' : 
                         j + '-' + (j + 1);
      
      var segment_path_vector = leastCostCorridor(segment_start, segment_end);
      var segment_low_gradient = convolutionEdgeDetection(clipped_cost, segment_path_vector);
      addPathLayers(segment_path_vector, segment_low_gradient, segment_label, corridor_color, corridor_width, low_gradient_color);
    }
  }
  
  // Always show the complete start to end corridor
  var complete_path_vector = leastCostCorridor(start_fc, end_fc);
  var complete_low_gradient = convolutionEdgeDetection(clipped_cost, complete_path_vector);
  addPathLayers(complete_path_vector, complete_low_gradient, 'Start-End', corridor_color, corridor_width, low_gradient_color);
  
  // Add start and end points to the map
  Map.addLayer(start_fc, {color: 'red'}, 'Start Point');
  Map.addLayer(end_fc, {color: 'red'}, 'End Point');
  
  // Add intermediate points to map with numbering
  for (var i = 0; i < sorted_point_fcs.length; i++) {
    Map.addLayer(sorted_point_fcs[i], {color: 'blue'}, 'Point ' + (i + 1));
  }
}

// Process all points automatically
// Set second parameter to true to see individual segments
processAllSegments(start_point_geom, end_point_geom, intermediate_points_coords, false);