# Feature Design: Allow Users to Set Their Name After Joining a Trip

## Overview
This design proposes adding the ability for users to set display names within trips, enhancing user experience by replacing email-based identification with more personal names. The feature maintains backward compatibility, ensures real-time updates, and is designed to scale with the application.

## Current State Analysis
- **Trip Interface**: Members are stored as an array of strings (emails).
- **Member Management**: Users join trips via email invitation. Members are displayed as emails in the UI.
- **Bills and Payments**: PaidBy and involved members are referenced by email strings.
- **Real-time Updates**: Implemented via Firestore onSnapshot listeners.

## Proposed Data Structure Changes

### Updated Trip Interface
```typescript
interface Trip {
  // ... existing fields
  members: Member[];
  // ... existing fields
}

interface Member {
  email: string;
  name?: string; // Optional display name
}
```

### Rationale
- Maintains email as the unique identifier for authentication and membership.
- Adds optional name field for display purposes.
- Allows gradual adoption (existing members can have undefined names).

## UI Flow for Setting Names

### Primary Flow: Members Tab Editing
1. In the trip view, navigate to the "Members" tab.
2. For each member, display the name if set, otherwise display the email.
3. If the current user is viewing their own member entry, provide an inline edit option.
4. Clicking edit reveals an input field pre-filled with current name (or empty).
5. On save, update the member's name in the trip document.

### Alternative Flow: Post-Join Prompt
- When a user first views a trip where their name is not set, display a non-intrusive prompt.
- Prompt includes an input field to set name, with options to "Set Name" or "Skip".
- This ensures new joiners are encouraged to personalize their presence.

### Visual Design
- Member list: Show avatar (initials or icon) + name/email.
- Edit mode: Inline input with save/cancel buttons.
- Prompt: Toast-style notification or modal overlay.

## Backend Changes

### Storage
- Utilize existing Firestore trip documents.
- Members array now contains objects instead of strings.
- No additional collections or indexes required.

### Retrieval
- Existing onSnapshot listeners will automatically receive updated member data.
- Client-side logic to map emails to names for display.

### Updates
- Leverage existing `updateField` function for real-time updates.
- Changes to member names trigger updates across all connected clients.

## Migration Considerations

### Data Migration Strategy
1. **One-time Script**: Create a Node.js script to migrate existing trips.
   ```javascript
   // Pseudo-code
   const tripsRef = collection(db, "trips");
   const snapshot = await getDocs(tripsRef);
   snapshot.forEach(async (doc) => {
     const data = doc.data();
     if (Array.isArray(data.members) && typeof data.members[0] === 'string') {
       const migratedMembers = data.members.map(email => ({ email, name: undefined }));
       await updateDoc(doc.ref, { members: migratedMembers });
     }
   });
   ```

2. **In-App Migration**: As a fallback, add client-side migration logic.
   - When loading a trip, check if members are strings.
   - If so, convert and update the document.

### Backward Compatibility
- Existing bills and references remain functional (emails are preserved).
- UI gracefully handles both old and new data formats during transition.

## Edge Cases and Error Handling

### Name Validation
- Allow empty names (fallback to email display).
- Trim whitespace; reject names longer than 50 characters.
- No special character restrictions beyond basic sanitization.

### Concurrent Edits
- Firestore handles conflicts; last write wins.
- UI should refresh on conflicts to show latest state.

### User Not in Members
- Query already filters trips by member emails.
- If a user is removed, they lose access to the trip.

### Duplicate Emails
- Enforce uniqueness at the database level (though Firebase Auth prevents this).

### Offline Scenarios
- Changes queue via Firestore's offline capabilities.
- Sync on reconnection.

## Scalability and Performance

### Database Scalability
- Firestore scales horizontally; member array size is typically small (<20 members).
- No additional queries or complex operations added.

### Real-time Updates
- Existing onSnapshot listeners handle name changes efficiently.
- Minimal payload increase (adding name field to member objects).

### Client-side Performance
- Member name lookups: O(n) where n is member count (negligible).
- UI re-renders only affected components on updates.

## Implementation Plan

### Phase 1: Data Structure Updates
- Update TypeScript interfaces.
- Implement migration script.
- Update addMember logic to create Member objects.

### Phase 2: UI Implementation
- Modify Members tab to display names.
- Add inline editing for current user's name.
- Implement post-join prompt if needed.

### Phase 3: Integration and Testing
- Update bill-related displays to show names.
- Test real-time updates across multiple clients.
- Validate migration on staging data.

### Phase 4: Deployment
- Run migration script on production.
- Monitor for any issues post-deployment.

## Security Considerations
- Names are user-controlled display data; no security implications.
- Email remains the authoritative identifier for access control.
- Input sanitization to prevent XSS in name fields.

## Future Enhancements
- Avatar support (integrate with Google profile pictures).
- Name change history or notifications.
- Default name suggestions based on email or Google profile.

This design ensures a smooth, user-friendly addition to the trip collaboration experience while maintaining the app's real-time and scalable nature.