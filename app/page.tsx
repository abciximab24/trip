"use client";
import { useState, useEffect } from 'react';
import { auth, provider, db } from '../firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";
import { collection, query, where, onSnapshot, doc, updateDoc, addDoc } from "firebase/firestore";

// --- Types ---
interface Event { title: string; time: string; desc: string; type: 'spot' | 'food' | 'transport'; lat?: number; lng?: number; }
interface Day { day: string; date: string; location: string; events: Event[]; }
interface Member { email: string; name?: string; }
interface Trip {
  id?: string;
  title: string;
  dateRange: string;
  city: string;
  coverColor: string;
  members: Member[];
   memberEmails: string[];
  days: Day[];
  flight?: { out?: string; in?: string; outTime?: string; inTime?: string };
  hotel?: { name: string; address: string };
  checkInDate?: string;
  checkOutDate?: string;
  currencyRates?: { from: string; to: string; rate: number }[];
  bills?: { amount: number; currency: string; description: string; date: string; paidBy: string; involvedMembers: string[] }[];
}

const fetchFlightTime = async (flightNumber: string, date: string, isOutbound: boolean) => {
  flightNumber = flightNumber.trim();
  console.log('Fetching flight time for:', flightNumber, date, isOutbound);
  if (!flightNumber || !date) {
    console.log('Missing flightNumber or date');
    return null;
  }
  try {
    const url = `https://api.aviationstack.com/v1/flights?access_key=${process.env.NEXT_PUBLIC_AVIATIONSTACK_API_KEY}&flight_iata=${flightNumber}&date=${date}`;
    console.log('Fetching URL:', url);
    const response = await fetch(url);
    console.log('Response status:', response.status);
    const data = await response.json();
    console.log('API response data:', data);
    if (data.data && data.data.length > 0) {
      const flight = data.data[0];
      const fullTime = isOutbound ? flight.departure.scheduled : flight.arrival.scheduled;
      const time = fullTime ? fullTime.split('T')[1].split('+')[0].slice(0, 5) : null;
      console.log('Found flight time:', time);
      return time;
    } else {
      console.log('No flight data found');
    }
  } catch (err) {
    console.error('Failed to fetch flight time:', err);
  }
  return null;
};

export default function TravelApp() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<'login' | 'home' | 'trip'>('login');
  const [trips, setTrips] = useState<Trip[]>([]);
  const [currentTrip, setCurrentTrip] = useState<Trip | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [activeTab, setActiveTab] = useState<'members' | 'trip-info' | 'itinerary' | 'currency' | 'bills'>('trip-info');
  const [exchangeRates, setExchangeRates] = useState<{ [key: string]: number } | null>(null);
  const [isAddingBill, setIsAddingBill] = useState(false);
  const [newBill, setNewBill] = useState({ description: '', amount: 0, currency: 'HKD', date: new Date().toISOString().split('T')[0], paidBy: '', involvedMembers: [] as string[] });
  const [converterAmount, setConverterAmount] = useState<string>('0');
  const [converterCurrency, setConverterCurrency] = useState<string>('JPY');
  const [editingMemberEmail, setEditingMemberEmail] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');

  // Fetch flight times when flight numbers or dates change
  useEffect(() => {
    console.log('useEffect for out flight triggered:', currentTrip?.flight?.out, currentTrip?.checkInDate);
    if (currentTrip?.flight?.out && currentTrip.checkInDate) {
      fetchFlightTime(currentTrip.flight.out, currentTrip.checkInDate, true).then(time => {
        console.log('Fetched out time:', time);
        if (time) updateField({ flight: { ...currentTrip.flight, outTime: time } });
      });
    }
  }, [currentTrip?.flight?.out, currentTrip?.checkInDate]);

  useEffect(() => {
    console.log('useEffect for in flight triggered:', currentTrip?.flight?.in, currentTrip?.checkOutDate);
    if (currentTrip?.flight?.in && currentTrip.checkOutDate) {
      fetchFlightTime(currentTrip.flight.in, currentTrip.checkOutDate, false).then(time => {
        console.log('Fetched in time:', time);
        if (time) updateField({ flight: { ...currentTrip.flight, inTime: time } });
      });
    }
  }, [currentTrip?.flight?.in, currentTrip?.checkOutDate]);

  // Fetch flight times when trip loads if not already set
  useEffect(() => {
    if (currentTrip?.flight?.out && currentTrip.checkInDate && !currentTrip.flight.outTime) {
      fetchFlightTime(currentTrip.flight.out, currentTrip.checkInDate, true).then(time => {
        if (time) updateField({ flight: { ...currentTrip.flight, outTime: time } });
      });
    }
    if (currentTrip?.flight?.in && currentTrip.checkOutDate && !currentTrip.flight.inTime) {
      fetchFlightTime(currentTrip.flight.in, currentTrip.checkOutDate, false).then(time => {
        if (time) updateField({ flight: { ...currentTrip.flight, inTime: time } });
      });
    }
  }, [currentTrip?.id]);

  // --- Sync & Auth ---
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      u ? (setUser(u), setView('home')) : (setUser(null), setView('login'));
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    console.log('Setting up Firestore listener for user:', user.email);
    const q = query(collection(db, "trips"), where("memberEmails", "array-contains", user.email?.toLowerCase()));
    return onSnapshot(q, (snapshot) => {
      console.log('Firestore snapshot received, docs count:', snapshot.docs.length);
      const docs = snapshot.docs.map(d => {
        const data = d.data();
        const baseTrip = { id: d.id, ...data } as Trip;
        // Migration: if members are strings, convert to Member[]
        if (Array.isArray(data.members) && data.members.length > 0 && typeof data.members[0] === 'string') {
          console.log('Migrating trip:', d.id, 'old members:', data.members);
          const migratedMembers = (data.members as string[]).map(email => ({ email, name: undefined }));
          const migratedMemberEmails = data.members as string[];
          const migratedTrip = { ...baseTrip, members: migratedMembers, memberEmails: migratedMemberEmails };
          // Update the document asynchronously
          updateDoc(d.ref, { members: migratedMembers, memberEmails: migratedMemberEmails }).catch(err => console.error('Migration update failed:', err));
          console.log('Migrated trip:', migratedTrip);
          return migratedTrip;
        }
        return baseTrip;
      });
      setTrips(docs);
      if (currentTrip) {
        const updated = docs.find(t => t.id === currentTrip.id);
        if (updated) setCurrentTrip(updated);
      }
    }, (error) => {
      console.error('Firestore listener error:', error);
    });
  }, [user, currentTrip?.id]);

  // --- Real-time Update Helper ---
  const updateField = async (newData: Partial<Trip>) => {
    if (!currentTrip?.id) return;
    await updateDoc(doc(db, "trips", currentTrip.id), newData);
  };

  const addDay = () => {
    if (!currentTrip) return;
    const newDays = [...(currentTrip.days || []), { day: `Day ${currentTrip.days.length + 1}`, date: "", location: "", events: [] }];
    updateField({ days: newDays });
  };

  const addMember = (email: string) => {
    if (!currentTrip || !email || !email.includes('@') || currentTrip.memberEmails.includes(email)) return;
    const newMember: Member = { email };
    const newMembers = [...currentTrip.members, newMember];
    const newMemberEmails = [...currentTrip.memberEmails, email];
    updateField({ members: newMembers, memberEmails: newMemberEmails });
  };

  const updateMemberName = (email: string, name: string) => {
    console.log('updateMemberName called:', email, name);
    if (!currentTrip) {
      console.error('No currentTrip');
      return;
    }
    const newMembers = currentTrip.members.map(m => m.email === email ? { ...m, name: name.trim() || undefined } : m);
    console.log('New members:', newMembers);
    updateField({ members: newMembers });
  };

  const getDisplayName = (email: string) => {
    const member = currentTrip?.members.find(m => m.email === email);
    return member?.name || email;
  };

  const addEvent = (dayIdx: number) => {
    const newDays = [...currentTrip!.days];
    newDays[dayIdx].events.push({ title: "New Activity", time: "12:00", desc: "", type: "spot" });
    updateField({ days: newDays });
  };

  // Fetch exchange rates when currency tab is active
  useEffect(() => {
    if (activeTab === 'currency' && !exchangeRates) {
      fetch('https://api.exchangerate-api.com/v4/latest/HKD')
        .then(res => res.json())
        .then(data => setExchangeRates(data.rates))
        .catch(err => console.error('Failed to fetch exchange rates:', err));
    }
  }, [activeTab, exchangeRates]);

  const getCurrenciesForCity = (city: string) => {
    if (city.toLowerCase().includes('tokyo') || city.toLowerCase().includes('fukuoka') || city.toLowerCase().includes('japan')) return ['JPY'];
    if (city.toLowerCase().includes('seoul') || city.toLowerCase().includes('korea')) return ['KRW'];
    if (city.toLowerCase().includes('bangkok') || city.toLowerCase().includes('thailand')) return ['THB'];
    if (city.toLowerCase().includes('singapore')) return ['SGD'];
    // default
    return ['USD', 'EUR', 'JPY', 'KRW', 'THB', 'SGD'];
  };

  if (view === 'login') return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#f9f7f2]">
      <h1 className="text-4xl font-bold mb-8 tracking-widest text-jp-text">RYOKOU</h1>
      <button onClick={() => signInWithPopup(auth, provider)} className="bg-white px-8 py-3 rounded-full shadow-lg border flex items-center gap-3">
        <img src="https://www.google.com/favicon.ico" className="w-5" alt=""/>
        <span className="font-bold text-gray-600">Start Collaborating</span>
      </button>
    </div>
  );

  return (
    <main className="max-w-md mx-auto min-h-screen bg-[#f9f7f2] shadow-2xl pb-20 relative">
      {/* Navigation Header */}
      <header className="p-6 flex justify-between items-center bg-white/80 sticky top-0 z-10 backdrop-blur border-b">
        {view === 'trip' ? (
          <button onClick={() => setView('home')} className="font-bold"><i className="fas fa-chevron-left mr-2"></i>Back</button>
        ) : <h1 className="text-2xl font-bold tracking-tighter">My Trips</h1>}
        <div className="flex gap-4">
          {view === 'trip' && (
            <button onClick={() => setIsEditing(!isEditing)} className={isEditing ? "text-jp-accent font-bold" : "text-gray-400"}>
              <i className="fas fa-magic mr-1"></i> {isEditing ? "Done" : "Edit Mode"}
            </button>
          )}
          <button onClick={() => signOut(auth)} className="text-red-400"><i className="fas fa-sign-out-alt"></i></button>
        </div>
      </header>

      {/* Trip List View */}
      {view === 'home' && (
        <div className="p-4 space-y-4">
          {trips.map(trip => (
            <div key={trip.id} onClick={() => { setCurrentTrip(trip); setView('trip'); }} className={`p-6 rounded-2xl bg-white border-l-8 ${trip.coverColor} shadow-sm cursor-pointer hover:scale-[1.02] transition-transform`}>
              <h2 className="text-xl font-bold">{trip.title}</h2>
              <p className="text-sm text-gray-400">{trip.dateRange}</p>
            </div>
          ))}
          <button onClick={async () => {
             const email = user?.email;
             const newTrip = { title: "New Journey", dateRange: "TBD", city: "Tokyo", coverColor: "border-jp-accent", members: [{ email }], memberEmails: [email], days: [] };
             const docRef = await addDoc(collection(db, "trips"), newTrip);
             setCurrentTrip({id: docRef.id, ...newTrip} as Trip);
             setView('trip');
             setIsEditing(true);
           }} className="w-full py-6 border-2 border-dashed border-gray-300 rounded-2xl text-gray-400">+ Plan a New Trip</button>
        </div>
      )}

      {/* Trip Detail & Collaborative Editor */}
      {view === 'trip' && currentTrip && (
        <div className="p-4 space-y-6 pb-24">
          {/* Tab Content */}
          {activeTab === 'trip-info' && (
            <>
              <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                {isEditing ? (
                  <>
                    <input
                      className="text-3xl font-bold w-full border-b focus:outline-none focus:border-jp-accent"
                      value={currentTrip.title}
                      onChange={(e) => updateField({ title: e.target.value })}
                    />
                    <div className="space-y-2 mt-4">
                      <input type="date" className="w-full border rounded p-2" value={currentTrip.checkInDate || ''} onChange={(e) => updateField({ checkInDate: e.target.value })} />
                      <input type="date" className="w-full border rounded p-2" value={currentTrip.checkOutDate || ''} onChange={(e) => updateField({ checkOutDate: e.target.value })} />
                      <input placeholder="City" className="w-full border rounded p-2" value={currentTrip.city} onChange={(e) => updateField({ city: e.target.value })} />
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="text-3xl font-bold">{currentTrip.title}</h2>
                    <p className="text-gray-400 mt-2">{currentTrip.dateRange} · {currentTrip.city}</p>
                    <p className="text-gray-400">Check-in: {currentTrip.checkInDate || 'N/A'} | Check-out: {currentTrip.checkOutDate || 'N/A'}</p>
                  </>
                )}
              </section>

              {/* Quick Info: Flight & Hotel */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-blue-50 p-4 rounded-2xl">
                  <h4 className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-1">Flight</h4>
                  {isEditing ? (
                    <div className="space-y-1">
                      <input placeholder="Outbound Flight No." className="bg-transparent text-sm w-full" value={currentTrip.flight?.out || ''} onChange={(e) => updateField({ flight: { out: e.target.value, in: currentTrip.flight?.in || '' } })} />
                      <input placeholder="Return Flight No." className="bg-transparent text-sm w-full" value={currentTrip.flight?.in || ''} onChange={(e) => updateField({ flight: { out: currentTrip.flight?.out || '', in: e.target.value } })} />
                    </div>
                  ) : (
                    <p className="text-sm">
                      <span className="font-bold">Outbound: {currentTrip.flight?.out || 'N/A'} {currentTrip.flight?.outTime ? `(${currentTrip.flight.outTime})` : ''}</span><br/>
                      <span className="font-bold">Return: {currentTrip.flight?.in || 'N/A'} {currentTrip.flight?.inTime ? `(${currentTrip.flight.inTime})` : ''}</span>
                    </p>
                  )}
                </div>
                <div className="bg-green-50 p-4 rounded-2xl">
                  <h4 className="text-xs font-bold text-green-400 uppercase tracking-widest mb-1">Hotel</h4>
                  {isEditing ? (
                    <div className="space-y-1">
                      <input placeholder="Hotel Name" className="bg-transparent text-sm w-full" value={currentTrip.hotel?.name || ''} onChange={(e) => updateField({ hotel: { name: e.target.value, address: currentTrip.hotel?.address || '' } })} />
                      <input placeholder="Hotel Address" className="bg-transparent text-sm w-full" value={currentTrip.hotel?.address || ''} onChange={(e) => updateField({ hotel: { name: currentTrip.hotel?.name || '', address: e.target.value } })} />
                    </div>
                  ) : (
                    <p className="text-sm">
                      <span className="font-bold">{currentTrip.hotel?.name || 'N/A'}</span><br/>
                      <span className="font-bold">{currentTrip.hotel?.address || 'N/A'}</span>
                    </p>
                  )}
                </div>
              </div>
            </>
          )}

          {activeTab === 'itinerary' && (
            <div className="space-y-8">
              {currentTrip.days.map((day, dIdx) => (
                <div key={dIdx} className="relative">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="bg-jp-text text-white px-3 py-1 rounded-lg text-xs font-bold">{day.day}</span>
                    {isEditing ? (
                      <input className="font-bold text-gray-600 bg-transparent border-b" value={day.location} onChange={(e) => {
                          const newDays = [...currentTrip.days];
                          newDays[dIdx].location = e.target.value;
                          updateField({ days: newDays });
                      }} />
                    ) : <span className="font-bold text-gray-600">{day.location}</span>}
                  </div>

                  <div className="border-l-2 border-gray-200 ml-4 pl-6 space-y-4">
                    {day.events.map((ev, eIdx) => (
                      <div key={eIdx} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-50 group relative">
                        <div className="flex gap-3">
                          {isEditing ? (
                            <div className="flex-1 space-y-2">
                              <div className="flex gap-2">
                                  <input className="text-xs font-mono w-16 bg-gray-100 p-1 rounded" value={ev.time} onChange={(e) => {
                                      const newDays = [...currentTrip.days];
                                      newDays[dIdx].events[eIdx].time = e.target.value;
                                      updateField({ days: newDays });
                                  }} />
                                  <input className="font-bold flex-1 border-b" value={ev.title} onChange={(e) => {
                                      const newDays = [...currentTrip.days];
                                      newDays[dIdx].events[eIdx].title = e.target.value;
                                      updateField({ days: newDays });
                                  }} />
                              </div>
                              <textarea className="text-sm text-gray-500 w-full bg-gray-50 p-2 rounded" value={ev.desc} onChange={(e) => {
                                      const newDays = [...currentTrip.days];
                                      newDays[dIdx].events[eIdx].desc = e.target.value;
                                      updateField({ days: newDays });
                              }} />
                            </div>
                          ) : (
                            <div className="flex-1">
                              <span className="text-xs font-mono text-jp-accent">{ev.time}</span>
                              <h4 className="font-bold text-jp-text">{ev.title}</h4>
                              <p className="text-sm text-gray-500">{ev.desc}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {isEditing && (
                      <button onClick={() => addEvent(dIdx)} className="text-xs text-gray-400 hover:text-jp-accent">+ Add Activity</button>
                    )}
                  </div>
                </div>
              ))}
              {isEditing && (
                <button onClick={addDay} className="w-full py-4 bg-white border-2 border-dashed rounded-2xl text-gray-400 font-bold">+ Add Next Day</button>
              )}
            </div>
          )}

          {activeTab === 'members' && (
            <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <h3 className="text-xl font-bold mb-4">Members</h3>
              <div className="space-y-2">
                {currentTrip.members.map((member, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    {editingMemberEmail === member.email ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          className="flex-1 border rounded p-1 text-sm"
                          value={tempName}
                          onChange={(e) => setTempName(e.target.value)}
                        />
                        <button onClick={() => { console.log('Save clicked for', member.email, 'name:', tempName); updateMemberName(member.email, tempName); setEditingMemberEmail(null); }} className="bg-green-500 text-white px-2 py-1 rounded text-sm">Save</button>
                        <button onClick={() => setEditingMemberEmail(null)} className="bg-gray-500 text-white px-2 py-1 rounded text-sm">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-1">
                        <span className="text-sm">{getDisplayName(member.email)}</span>
                        {member.email === user?.email && (
                          <button onClick={() => { console.log('Edit clicked for', member.email); setEditingMemberEmail(member.email); setTempName(member.name || ''); }} className="text-gray-400 hover:text-jp-accent">
                            <i className="fas fa-edit"></i>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <input
                  placeholder="New member email"
                  className="flex-1 border rounded p-2"
                  value={newMemberEmail}
                  onChange={(e) => setNewMemberEmail(e.target.value)}
                />
                <button onClick={() => { addMember(newMemberEmail); setNewMemberEmail(''); }} style={{ backgroundColor: 'blue', color: 'white', padding: '8px 16px', borderRadius: '4px', border: '1px solid blue' }}>Add</button>
              </div>
            </section>
          )}

          {activeTab === 'currency' && (
            <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <h3 className="text-xl font-bold mb-4">Currency Converter</h3>
              {exchangeRates ? (
                <div className="space-y-6">
                  {/* Converter Tool */}
                  <div className="bg-blue-50 p-4 rounded-xl">
                    <h4 className="font-bold mb-3">Convert to HKD</h4>
                    <div className="flex gap-2 mb-3">
                      <input
                        type="number"
                        placeholder="Amount"
                        className="flex-1 p-2 border rounded"
                        value={converterAmount}
                        onChange={(e) => setConverterAmount(e.target.value)}
                      />
                      <select
                        className="p-2 border rounded"
                        value={converterCurrency}
                        onChange={(e) => setConverterCurrency(e.target.value)}
                      >
                        {getCurrenciesForCity(currentTrip.city).map(currency => (
                          <option key={currency} value={currency}>{currency}</option>
                        ))}
                      </select>
                    </div>
                    <div className="text-lg font-bold text-green-600">
                      {converterAmount} {converterCurrency} = {(parseFloat(converterAmount) / (exchangeRates[converterCurrency] || 1)).toFixed(2)} HKD
                    </div>
                  </div>

                  {/* Rates Display */}
                  <div>
                    <div className="text-sm text-gray-600 mb-4">
                      Current Rates (HKD Base):
                    </div>
                    {getCurrenciesForCity(currentTrip.city).map(currency => (
                      <div key={currency} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg mb-2">
                        <span className="font-bold">1 HKD = {exchangeRates[currency]?.toFixed(4)} {currency}</span>
                        <span className="text-sm text-gray-500">{currency}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p>Loading exchange rates...</p>
              )}
            </section>
          )}

          {activeTab === 'bills' && (
            <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">Bills</h3>
                {!isAddingBill ? (
                  <button onClick={() => setIsAddingBill(true)} className="bg-blue-500 text-white px-6 py-3 rounded-full text-sm font-bold shadow-lg">+ Add Bill</button>
                ) : (
                  <button onClick={() => setIsAddingBill(false)} className="bg-gray-500 text-white px-6 py-3 rounded-full text-sm font-bold shadow-lg">Cancel</button>
                )}
              </div>
              <div className="space-y-4">
                {currentTrip.bills?.map((bill, idx) => {
                  const splitAmount = bill.amount / bill.involvedMembers.length;
                  return (
                    <div key={idx} className="bg-gray-50 p-4 rounded-xl border">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="font-bold">{bill.description}</h4>
                        <span className="text-lg font-bold text-green-600">{bill.amount} {bill.currency}</span>
                      </div>
                      <p className="text-sm text-gray-600">Paid by: {getDisplayName(bill.paidBy) || 'N/A'}</p>
                      <p className="text-sm text-gray-600">Date: {bill.date}</p>
                      <p className="text-sm text-gray-600">Each involved member owes: {splitAmount.toFixed(2)} {bill.currency} to {getDisplayName(bill.paidBy) || 'N/A'}</p>
                      <p className="text-sm text-gray-600">Involved: {(bill.involvedMembers || []).map(email => getDisplayName(email)).join(', ')}</p>
                    </div>
                  );
                }) || <p className="text-gray-500">No bills yet</p>}
              </div>
              {isAddingBill && (
                <div className="mt-6 p-4 bg-blue-50 rounded-xl">
                  <h4 className="font-bold mb-4">Add New Bill</h4>
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="Description"
                      className="w-full p-2 border rounded"
                      value={newBill.description}
                      onChange={(e) => setNewBill({ ...newBill, description: e.target.value })}
                    />
                    <div className="flex gap-2">
                      <input
                        type="number"
                        placeholder="Amount"
                        className="flex-1 p-2 border rounded"
                        value={newBill.amount}
                        onChange={(e) => setNewBill({ ...newBill, amount: parseFloat(e.target.value) || 0 })}
                      />
                      <select
                        className="p-2 border rounded"
                        value={newBill.currency}
                        onChange={(e) => setNewBill({ ...newBill, currency: e.target.value })}
                      >
                        <option>HKD</option>
                        <option>JPY</option>
                        <option>USD</option>
                        <option>EUR</option>
                      </select>
                    </div>
                    <input
                      type="date"
                      className="w-full p-2 border rounded"
                      value={newBill.date}
                      onChange={(e) => setNewBill({ ...newBill, date: e.target.value })}
                    />
                    <select
                      className="w-full p-2 border rounded"
                      value={newBill.paidBy}
                      onChange={(e) => setNewBill({ ...newBill, paidBy: e.target.value })}
                    >
                      <option value="">Select who paid</option>
                      {currentTrip.members.map(member => (
                        <option key={member.email} value={member.email}>{member.name || member.email}</option>
                      ))}
                    </select>
                    <div>
                      <label className="block text-sm font-medium mb-1">Who is involved?</label>
                      <div className="space-y-1">
                        {currentTrip.members.map(member => (
                          <label key={member.email} className="flex items-center">
                            <input
                              type="checkbox"
                              checked={newBill.involvedMembers.includes(member.email)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setNewBill({ ...newBill, involvedMembers: [...newBill.involvedMembers, member.email] });
                                } else {
                                  setNewBill({ ...newBill, involvedMembers: newBill.involvedMembers.filter(m => m !== member.email) });
                                }
                              }}
                              className="mr-2"
                            />
                            {member.name || member.email}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => {
                          if (newBill.description && newBill.amount > 0 && newBill.paidBy && newBill.involvedMembers.length > 0) {
                            const updatedBills = [...(currentTrip.bills || []), newBill];
                            updateField({ bills: updatedBills });
                            setNewBill({ description: '', amount: 0, currency: 'HKD', date: new Date().toISOString().split('T')[0], paidBy: '', involvedMembers: [] });
                            setIsAddingBill(false);
                          }
                        }}
                        className="bg-green-500 text-white px-4 py-2 rounded"
                      >
                        Save Bill
                      </button>
                      <button
                        onClick={() => setIsAddingBill(false)}
                        className="bg-gray-500 text-white px-4 py-2 rounded"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* Bottom Tab Navigation */}
      {view === 'trip' && currentTrip && (
        <div className="fixed bottom-0 left-1/2 transform -translate-x-1/2 max-w-md w-full bg-white border-t border-gray-200 shadow-lg">
          <div className="flex justify-around py-2">
            <button onClick={() => setActiveTab('members')} className={`flex flex-col items-center py-2 px-3 ${activeTab === 'members' ? 'text-jp-accent' : 'text-gray-400'}`}>
              <i className="fas fa-users text-lg mb-1"></i>
              <span className="text-xs">Members</span>
            </button>
            <button onClick={() => setActiveTab('trip-info')} className={`flex flex-col items-center py-2 px-3 ${activeTab === 'trip-info' ? 'text-jp-accent' : 'text-gray-400'}`}>
              <i className="fas fa-info-circle text-lg mb-1"></i>
              <span className="text-xs">Trip Info</span>
            </button>
            <button onClick={() => setActiveTab('itinerary')} className={`flex flex-col items-center py-2 px-3 ${activeTab === 'itinerary' ? 'text-jp-accent' : 'text-gray-400'}`}>
              <i className="fas fa-calendar-alt text-lg mb-1"></i>
              <span className="text-xs">Itinerary</span>
            </button>
            <button onClick={() => setActiveTab('currency')} className={`flex flex-col items-center py-2 px-3 ${activeTab === 'currency' ? 'text-jp-accent' : 'text-gray-400'}`}>
              <i className="fas fa-exchange-alt text-lg mb-1"></i>
              <span className="text-xs">Currency</span>
            </button>
            <button onClick={() => setActiveTab('bills')} className={`flex flex-col items-center py-2 px-3 ${activeTab === 'bills' ? 'text-jp-accent' : 'text-gray-400'}`}>
              <i className="fas fa-receipt text-lg mb-1"></i>
              <span className="text-xs">Bills</span>
            </button>
          </div>
        </div>
      )}

      {/* FontAwesome */}
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
    </main>
  );
}