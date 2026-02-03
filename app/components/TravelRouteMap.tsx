"use client";
import React, { useState, useEffect, useRef } from 'react';
import { geocodeAddress, getDirections, DirectionsResult, initializeGoogleMaps } from '../utils/googleMaps';

interface TravelRouteMapProps {
  origin?: { lat: number; lng: number; name?: string };
  destination?: string | { lat: number; lng: number; name?: string };
  travelMode?: google.maps.TravelMode;
}

const TravelRouteMap: React.FC<TravelRouteMapProps> = ({ origin, destination, travelMode = google.maps.TravelMode.DRIVING }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [directionsRenderer, setDirectionsRenderer] = useState<google.maps.DirectionsRenderer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [directionsData, setDirectionsData] = useState<DirectionsResult | null>(null);
  const [showPanel, setShowPanel] = useState(false);

  useEffect(() => {
    if (!origin || !destination) {
      setError('請先添加航班和飯店資訊');
      setIsLoading(false);
      return;
    }

    const initMap = async () => {
      try {
        initializeGoogleMaps();
        const { Map } = await google.maps.importLibrary("maps") as google.maps.MapsLibrary;
        if (!mapRef.current) return;
        const mapInstance = new Map(mapRef.current, {
          center: { lat: origin.lat, lng: origin.lng },
          zoom: 12,
        });
        const renderer = new google.maps.DirectionsRenderer();
        renderer.setMap(mapInstance);
        setMap(mapInstance);
        setDirectionsRenderer(renderer);

        // Get directions
        let destCoords: { lat: number; lng: number } | null = null;
        if (typeof destination === 'string') {
          const geocoded = await geocodeAddress(destination);
          if (!geocoded) {
            setError('無法地理編碼目的地');
            setIsLoading(false);
            return;
          }
          destCoords = geocoded;
        } else {
          destCoords = destination;
        }

        const directions = await getDirections(origin, destCoords, travelMode);
        if (!directions) {
          setError('無法獲取路線');
          setIsLoading(false);
          return;
        }

        // Render directions
        const directionsService = new google.maps.DirectionsService();
        const request: google.maps.DirectionsRequest = {
          origin: new google.maps.LatLng(origin.lat, origin.lng),
          destination: new google.maps.LatLng(destCoords.lat, destCoords.lng),
          travelMode,
        };

        directionsService.route(request, (result, status) => {
          if (status === google.maps.DirectionsStatus.OK && result) {
            renderer.setDirections(result);
            setDirectionsData(directions);
          } else {
            setError('無法渲染路線');
          }
          setIsLoading(false);
        });
      } catch (err) {
        setError('載入地圖失敗');
        setIsLoading(false);
      }
    };

    initMap();
  }, [origin, destination, travelMode]);

  const handleZoomIn = () => {
    if (map) map.setZoom((map.getZoom() || 0) + 1);
  };

  const handleZoomOut = () => {
    if (map) map.setZoom((map.getZoom() || 0) - 1);
  };

  return (
    <div className="relative w-full h-96">
      <div ref={mapRef} className="w-full h-full" />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-75">
          <div className="text-lg">載入中...</div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-75">
          <div className="text-lg text-red-500">{error}</div>
        </div>
      )}
      {directionsData && (
        <>
          <div className="absolute top-4 right-4 bg-white p-2 rounded shadow">
            <button onClick={handleZoomIn} className="block">+</button>
            <button onClick={handleZoomOut} className="block">-</button>
            <button onClick={() => setShowPanel(!showPanel)} className="block">📋</button>
          </div>
          {showPanel && (
            <div className="absolute bottom-0 left-0 right-0 md:top-0 md:left-auto md:w-80 md:h-full bg-white shadow-lg overflow-y-auto">
              <div className="p-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold">路線方向</h3>
                  <button onClick={() => setShowPanel(false)}>✕</button>
                </div>
                <div className="mb-4">
                  <p>距離: {directionsData.distance}</p>
                  <p>持續時間: {directionsData.duration}</p>
                </div>
                <ul>
                  {directionsData.steps.map((step, idx) => (
                    <li key={idx} className="mb-2">
                      <div dangerouslySetInnerHTML={{ __html: step.instructions }} />
                      <p className="text-sm text-gray-500">{step.distance} - {step.duration}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default TravelRouteMap;