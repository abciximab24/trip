"use client";
import React, { useState, useEffect, useRef } from 'react';
import { geocodeAddress, getDirections, DirectionsResult, initializeGoogleMaps } from '../utils/googleMaps';

interface TravelRouteMapProps {
  origin?: string | { lat: number; lng: number; name?: string };
  destination?: string | { lat: number; lng: number; name?: string };
  travelMode?: google.maps.TravelMode;
}

// Function to get accurate transit information for major airport routes
const getTransitInfo = async (origin: { lat: number; lng: number }, dest: { lat: number; lng: number }): Promise<DirectionsResult | null> => {
  // Check for Narita Airport to Tokyo routes
  const isNaritaToTokyo = (
    Math.abs(origin.lat - 35.77) < 0.1 && Math.abs(origin.lng - 140.38) < 0.1 && // Narita Airport
    Math.abs(dest.lat - 35.69) < 0.1 && Math.abs(dest.lng - 139.77) < 0.1    // Tokyo area
  );

  if (isNaritaToTokyo) {
    // Try to get real-time transit data from external API
    try {
      // You can integrate with Hyperdia API or similar here
      // For now, return accurate static data based on official schedules
      return {
        distance: '約 57 公里',
        duration: '約 36 分鐘 - 1 小時',
        steps: [
          {
            instructions: '🚄 成田特快 (NEX) - 直達東京站 | 票價: ¥3,020 | 班次: 每 30 分鐘',
            distance: '57 公里',
            duration: '約 1 小時'
          },
          {
            instructions: '🚄 Keisei Skyliner - 至日暮里站，轉乘 JR 山手線 | 票價: ¥2,520 | 班次: 每 40 分鐘',
            distance: '57 公里',
            duration: '約 36 分鐘'
          },
          {
            instructions: '🚌 機場巴士 (Limusine) - 直達主要酒店 | 票價: ¥3,100 | 班次: 每 1-2 小時',
            distance: '57 公里',
            duration: '約 1.5-2 小時'
          },
          {
            instructions: '🚇 成田機場線 + 轉乘 - 經濟選擇 | 票價: ¥1,320 | 班次: 頻繁',
            distance: '57 公里',
            duration: '約 1.5 小時'
          }
        ],
        polyline: ''
      };
    } catch (error) {
      console.error('Failed to fetch transit data:', error);
      return null;
    }
  }

  // Check for other major routes
  // Add more airport routes as needed

  return null;
};

const TravelRouteMap: React.FC<TravelRouteMapProps> = ({ origin, destination, travelMode = google.maps.TravelMode.DRIVING }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [directionsRenderer, setDirectionsRenderer] = useState<google.maps.DirectionsRenderer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [directionsData, setDirectionsData] = useState<DirectionsResult | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [selectedMode, setSelectedMode] = useState<google.maps.TravelMode>(google.maps.TravelMode.TRANSIT);

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
        const { Marker } = await google.maps.importLibrary("marker") as google.maps.MarkerLibrary;
        if (!mapRef.current) return;

        // Handle origin
        let originCoords: { lat: number; lng: number } | null = null;
        if (typeof origin === 'string') {
          const geocoded = await geocodeAddress(origin);
          if (!geocoded) {
            setError('無法地理編碼起點');
            setIsLoading(false);
            return;
          }
          originCoords = geocoded;
        } else {
          originCoords = origin;
        }

        const mapInstance = new Map(mapRef.current, {
          center: { lat: originCoords.lat, lng: originCoords.lng },
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

        let directions = await getDirections(originCoords, destCoords, selectedMode);

        // If Google Maps fails for transit, try our transit database
        if (!directions && selectedMode === google.maps.TravelMode.TRANSIT) {
          console.log('Google Maps transit failed, trying local transit database...');
          directions = await getTransitInfo(originCoords, destCoords);
        }

        if (!directions) {
          setError('無法獲取路線資訊。');
          setIsLoading(false);
          return;
        }

        // Check if we got directions from Google Maps or our transit database
        if (directions.polyline) {
          // We have a Google Maps route, render it
          const directionsService = new google.maps.DirectionsService();
          const request: google.maps.DirectionsRequest = {
            origin: new google.maps.LatLng(originCoords.lat, originCoords.lng),
            destination: new google.maps.LatLng(destCoords.lat, destCoords.lng),
            travelMode: selectedMode,
          };

          directionsService.route(request, (result, status) => {
            if (status === google.maps.DirectionsStatus.OK && result) {
              renderer.setDirections(result);
              setDirectionsData(directions);
            } else {
              // Fallback: just show markers
              const originMarker = new Marker({
                position: originCoords,
                map: mapInstance,
                title: '起點',
              });
              const destMarker = new Marker({
                position: destCoords,
                map: mapInstance,
                title: '目的地',
              });
              setDirectionsData(directions);
            }
            setIsLoading(false);
          });
        } else {
          // We have transit data from our database, show markers only
          const originMarker = new Marker({
            position: originCoords,
            map: mapInstance,
            title: '起點',
          });
          const destMarker = new Marker({
            position: destCoords,
            map: mapInstance,
            title: '目的地',
          });
          setDirectionsData(directions);
          setIsLoading(false);
        }
      } catch (err) {
        setError('載入地圖失敗');
        setIsLoading(false);
      }
    };

    initMap();
  }, [origin, destination, selectedMode]);

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
          <div className="absolute top-4 left-4 bg-white p-2 rounded shadow">
            <div className="text-xs font-bold text-gray-600 mb-1">公共交通</div>
            <div className="text-xs text-gray-500">
              {directionsData ? (
                <div>
                  <div>距離: {directionsData.distance}</div>
                  <div>時間: {directionsData.duration}</div>
                </div>
              ) : error ? (
                <div className="text-red-500">無法載入</div>
              ) : (
                <div>載入中...</div>
              )}
            </div>
          </div>
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