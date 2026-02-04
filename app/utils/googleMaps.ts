import { setOptions } from '@googlemaps/js-api-loader';

export const initializeGoogleMaps = () => {
  if (typeof window === 'undefined') return;
  setOptions({
    key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
    v: 'weekly',
  });
};



declare global {
  interface Window {
    google: typeof google;
  }
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

export const geocodeAddress = async (address: string): Promise<GeocodeResult | null> => {
  try {
    initializeGoogleMaps();
    const { Geocoder } = await google.maps.importLibrary("geocoding") as google.maps.GeocodingLibrary;
    const geocoder = new Geocoder();

    return new Promise((resolve) => {
      geocoder.geocode({ address }, (results, status) => {
        if (status === google.maps.GeocoderStatus.OK && results && results[0]) {
          const location = results[0].geometry!.location;
          resolve({
            lat: location.lat(),
            lng: location.lng(),
            formattedAddress: results[0].formatted_address,
          });
        } else {
          console.error('Geocoding failed:', status);
          resolve(null);
        }
      });
    });
  } catch (error) {
    console.error('Error loading Google Maps or geocoding:', error);
    return null;
  }
};

export interface DirectionsResult {
  distance: string;
  duration: string;
  steps: Array<{
    instructions: string;
    distance: string;
    duration: string;
  }>;
  polyline: string;
}

export const getDirections = async (
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  travelMode: google.maps.TravelMode = google.maps.TravelMode.DRIVING
): Promise<DirectionsResult | null> => {
  try {
    initializeGoogleMaps();
    const { DirectionsService } = await google.maps.importLibrary("routes") as google.maps.RoutesLibrary;
    const directionsService = new DirectionsService();

    // Try multiple approaches for transit
    if (travelMode === google.maps.TravelMode.TRANSIT) {
      // Try with current time first
      const currentTimeRequest: google.maps.DirectionsRequest = {
        origin: new google.maps.LatLng(origin.lat, origin.lng),
        destination: new google.maps.LatLng(destination.lat, destination.lng),
        travelMode,
        transitOptions: {
          departureTime: new Date(),
          modes: [google.maps.TransitMode.TRAIN, google.maps.TransitMode.BUS, google.maps.TransitMode.SUBWAY],
          routingPreference: google.maps.TransitRoutePreference.FEWER_TRANSFERS,
        },
      };

      const currentTimeResult = await new Promise<google.maps.DirectionsResult | null>((resolve) => {
        directionsService.route(currentTimeRequest, (result, status) => {
          console.log('Transit directions status (current time):', status);
          if (status === google.maps.DirectionsStatus.OK && result && result.routes[0]) {
            resolve(result);
          } else {
            resolve(null);
          }
        });
      });

      if (currentTimeResult) {
        const route = currentTimeResult.routes[0];
        const leg = route.legs[0];
        return {
          distance: leg.distance?.text || '',
          duration: leg.duration?.text || '',
          steps: leg.steps?.map((step) => ({
            instructions: step.instructions || '',
            distance: step.distance?.text || '',
            duration: step.duration?.text || '',
          })) || [],
          polyline: route.overview_polyline || '',
        };
      }

      // Try with future time
      const futureTimeRequest: google.maps.DirectionsRequest = {
        origin: new google.maps.LatLng(origin.lat, origin.lng),
        destination: new google.maps.LatLng(destination.lat, destination.lng),
        travelMode,
        transitOptions: {
          departureTime: new Date(Date.now() + 3600000), // 1 hour from now
          modes: [google.maps.TransitMode.TRAIN, google.maps.TransitMode.BUS, google.maps.TransitMode.SUBWAY],
          routingPreference: google.maps.TransitRoutePreference.FEWER_TRANSFERS,
        },
      };

      const futureTimeResult = await new Promise<google.maps.DirectionsResult | null>((resolve) => {
        directionsService.route(futureTimeRequest, (result, status) => {
          console.log('Transit directions status (future time):', status);
          if (status === google.maps.DirectionsStatus.OK && result && result.routes[0]) {
            resolve(result);
          } else {
            resolve(null);
          }
        });
      });

      if (futureTimeResult) {
        const route = futureTimeResult.routes[0];
        const leg = route.legs[0];
        return {
          distance: leg.distance?.text || '',
          duration: leg.duration?.text || '',
          steps: leg.steps?.map((step) => ({
            instructions: step.instructions || '',
            distance: step.distance?.text || '',
            duration: step.duration?.text || '',
          })) || [],
          polyline: route.overview_polyline || '',
        };
      }
    }

    // For non-transit modes or if transit failed
    const request: google.maps.DirectionsRequest = {
      origin: new google.maps.LatLng(origin.lat, origin.lng),
      destination: new google.maps.LatLng(destination.lat, destination.lng),
      travelMode,
    };

    return new Promise((resolve) => {
      directionsService.route(request, (result, status) => {
        console.log('Directions request status:', status, 'for mode:', travelMode);
        if (status === google.maps.DirectionsStatus.OK && result && result.routes[0]) {
          const route = result.routes[0];
          const leg = route.legs[0];

          resolve({
            distance: leg.distance?.text || '',
            duration: leg.duration?.text || '',
            steps: leg.steps?.map((step) => ({
              instructions: step.instructions || '',
              distance: step.distance?.text || '',
              duration: step.duration?.text || '',
            })) || [],
            polyline: route.overview_polyline || '',
          });
        } else {
          console.error('Directions request failed:', status, 'for mode:', travelMode);
          resolve(null);
        }
      });
    });
  } catch (error) {
    console.error('Error loading Google Maps or getting directions:', error);
    return null;
  }
};