# Footbag Website Modernization Project -- User Stories

**Last updated:** March 16, 2026

**Prepared by:** David Leberknight / [DavidLeberknight@gmail.com](mailto:DavidLeberknight@gmail.com)

**Document Purpose:**

This document is the Source of Truth for Functional Requirements, defining all User Stories and their user-facing implications for the Footbag Website Modernization Project. It covers all user roles: Visitor, Member (includes Event Organizer and Club Leader), Administrator, and system background processes, plus special flags for the IFPA Board, Hall of Fame (HoF) and Big Add Posse (BAP). Together these User Stories define the complete scope, describing what functionality must exist for users, and success criteria (system side effects).

## Table of Contents

- [1. Global Behaviors](#1-global-behaviors)
  - [1.1 Hashtags](#11-hashtags)
  - [1.2 Official Rules for Member Tiers](#12-official-rules-for-member-tiers)
- [2. Visitor Stories](#2-visitor-stories)
  - [2.1 Content Discovery](#21-content-discovery)
    - [V_Browse_Static_Content](#v_browse_static_content)
    - [V_Browse_Clubs](#v_browse_clubs)
    - [V_Browse_Upcoming_Events](#v_browse_upcoming_events)
    - [V_Browse_Past_Events](#v_browse_past_events)
    - [V_View_News_Feed](#v_view_news_feed)
    - [V_View_Tutorials](#v_view_tutorials)
    - [V_View_Gallery](#v_view_gallery)
    - [V_Browse_Hashtags](#v_browse_hashtags)
    - [V_Access_Denied](#v_access_denied)
    - [V_Not_Found](#v_not_found)
    - [V_Error_or_Maintenance_Mode](#v_error_or_maintenance_mode)
    - [V_Register_Account](#v_register_account)
- [3. Member Stories](#3-member-stories)
  - [3.1 Account Lifecycle](#31-account-lifecycle)
    - [M_Login](#m_login)
    - [M_Reset_Password](#m_reset_password)
    - [M_Change_Password](#m_change_password)
    - [M_Logout](#m_logout)
    - [M_Delete_Account](#m_delete_account)
    - [M_Restore_Account](#m_restore_account)
    - [M_Download_Data](#m_download_data)
    - [M_Browse_Legacy_Archive](#m_browse_legacy_archive)
    - [M_Claim_Legacy_Account](#m_claim_legacy_account)
    - [M_Review_Legacy_Club_Data_During_Claim](#m_review_legacy_club_data_during_claim)
  - [3.2 Profile Management](#32-profile-management)
    - [M_Edit_Profile](#m_edit_profile)
    - [M_Search_Members](#m_search_members)
    - [M_View_Profile](#m_view_profile)
  - [3.3 Club Membership](#33-club-membership)
    - [M_Join_Club](#m_join_club)
    - [M_Leave_Club](#m_leave_club)
    - [M_View_Club](#m_view_club)
  - [3.4 Event Participation](#34-event-participation)
    - [M_Register_For_Event](#m_register_for_event)
    - [M_View_Event](#m_view_event)
  - [3.5 Payments](#35-payments)
    - [M_Donate](#m_donate)
    - [M_View_Payment_History](#m_view_payment_history)
  - [3.6 Membership Tiers and Flags](#36-membership-tiers-and-flags)
    - [M_Purchase_Tier_1](#m_purchase_tier_1)
    - [M_Purchase_Tier_2](#m_purchase_tier_2)
    - [M_View_Tier_Status](#m_view_tier_status)
    - [M_Tier_Expiry_During_Active_Period](#m_tier_expiry_during_active_period)
    - [M_Vouch_For_Tier1_Member](#m_vouch_for_tier1_member)
  - [3.7 Voting](#37-voting)
    - [M_View_Vote_Options](#m_view_vote_options)
    - [M_Vote](#m_vote)
    - [M_Verify_Vote_And_View_Results](#m_verify_vote_and_view_results)
    - [M_Nominate_HoF_Candidate](#m_nominate_hof_candidate)
    - [M_Submit_HoF_Affidavit](#m_submit_hof_affidavit)
  - [3.8 Media Sharing](#38-media-sharing)
    - [M_Upload_Photo](#m_upload_photo)
    - [M_Submit_Video](#m_submit_video)
    - [M_Organize_Media_Galleries](#m_organize_media_galleries)
    - [M_Delete_Own_Media](#m_delete_own_media)
    - [M_Flag_Media](#m_flag_media)
  - [3.9 Email](#39-email)
    - [M_Manage_Email_Subscriptions](#m_manage_email_subscriptions)
    - [M_Send_Announce_Email](#m_send_announce_email)
- [4. Event Organizer Stories](#4-event-organizer-stories)
  - [4.1 Event Lifecycle](#41-event-lifecycle)
    - [Event Status Lifecycle](#event-status-lifecycle)
    - [M_Create_Event](#m_create_event)
    - [EO_Edit_Event](#eo_edit_event)
    - [EO_Delete_Event](#eo_delete_event)
    - [EO_Manage_CoOrganizers](#eo_manage_coorganizers)
  - [4.2 Registration Management](#42-registration-management)
    - [EO_View_Participants](#eo_view_participants)
    - [EO_Close_Registration](#eo_close_registration)
    - [EO_Export_Participants](#eo_export_participants)
  - [4.3 Communication](#43-communication)
    - [EO_Email_Participants](#eo_email_participants)
  - [4.4 Results Publishing](#44-results-publishing)
    - [EO_Upload_Results](#eo_upload_results)
- [5. Club Leader Stories](#5-club-leader-stories)
  - [5.1 Club Lifecycle](#51-club-lifecycle)
    - [M_Create_Club](#m_create_club)
    - [CL_Edit_Club](#cl_edit_club)
    - [CL_Mark_Club_Inactive](#cl_mark_club_inactive)
    - [CL_Archive_Club](#cl_archive_club)
  - [5.2 Leadership Management](#52-leadership-management)
    - [CL_Manage_CoLeaders](#cl_manage_coleaders)
- [6. Administrator Stories](#6-administrator-stories)
  - [6.1 Event and Payments](#61-event-and-payments)
    - [A_Approve_Sanctioned_Event](#a_approve_sanctioned_event)
    - [A_Reconcile_Payments](#a_reconcile_payments)
  - [6.2 Data Management](#62-data-management)
    - [A_Override_Member_Data](#a_override_member_data)
    - [A_Grant_HoF_BAP_Board_Status](#a_grant_hof_bap_board_status)
    - [A_View_Member_History](#a_view_member_history)
    - [A_View_Official_Roster_Reports](#a_view_official_roster_reports)
    - [A_Process_Tier1_Recognition_Requests](#a_process_tier1_recognition_requests)
    - [A_Reassign_Club_Leader](#a_reassign_club_leader)
    - [A_Reassign_Event_Organizer](#a_reassign_event_organizer)
    - [A_Fix_Event_Results](#a_fix_event_results)
    - [A_Mark_Member_Deceased](#a_mark_member_deceased)
    - [A_Manual_Legacy_Claim_Recovery](#a_manual_legacy_claim_recovery)
    - [A_Resolve_Bootstrap_Club_Leadership](#a_resolve_bootstrap_club_leadership)
  - [6.3 Content Moderation](#63-content-moderation)
    - [A_Moderate_Media](#a_moderate_media)
    - [A_Create_News_Item](#a_create_news_item)
    - [A_Moderate_News_Item](#a_moderate_news_item)
    - [A_Archive_Club](#a_archive_club)
  - [6.4 Vote Management](#64-vote-management)
    - [A_Create_Vote](#a_create_vote)
    - [A_Publish_Vote_Results](#a_publish_vote_results)
    - [A_Cancel_Vote](#a_cancel_vote)
  - [6.5 Email](#65-email)
    - [A_Send_Mailing_List_Email](#a_send_mailing_list_email)
    - [A_Manage_Mailing_Lists](#a_manage_mailing_lists)
  - [6.6 System Configuration](#66-system-configuration)
    - [A_View_Stripe_Config_And_Payments](#a_view_stripe_config_and_payments)
    - [A_Configure_System_Parameters](#a_configure_system_parameters)
    - [A_Manage_Admin_Role](#a_manage_admin_role)
  - [6.7 Configurable Parameters](#67-configurable-parameters)
    - [Membership Pricing / Dues (IFPA-derived)](#membership-pricing-dues-ifpa-derived)
    - [Membership Windows / Lifecycle](#membership-windows-lifecycle)
    - [Email / Notifications / Outbox](#email-notifications-outbox)
    - [Auth / Security Tokens](#auth-security-tokens)
    - [Retention / Cleanup](#retention-cleanup)
  - [6.8 Monitoring and Audit](#68-monitoring-and-audit)
    - [A_View_Dashboard](#a_view_dashboard)
    - [A_View_System_Health](#a_view_system_health)
    - [A_View_Audit_Logs](#a_view_audit_logs)
    - [A_Acknowledge_Alarm](#a_acknowledge_alarm)
- [7. Background System Jobs](#7-background-system-jobs)
    - [SYS_Check_Tier_Expiry](#sys_check_tier_expiry)
    - [SYS_Send_Email](#sys_send_email)
    - [SYS_Open_Vote](#sys_open_vote)
    - [SYS_Close_Vote](#sys_close_vote)
    - [SYS_Process_One_Time_Payments](#sys_process_one_time_payments)
    - [SYS_Process_Recurring_Donations](#sys_process_recurring_donations)
    - [SYS_Reconcile_Payments_Nightly](#sys_reconcile_payments_nightly)
    - [SYS_Cleanup_Expired_Tokens](#sys_cleanup_expired_tokens)
    - [SYS_Cleanup_Soft_Deleted_Records](#sys_cleanup_soft_deleted_records)
    - [SYS_Rebuild_Hashtag_Stats](#sys_rebuild_hashtag_stats)
    - [SYS_Handle_Stripe_Webhooks](#sys_handle_stripe_webhooks)
    - [SYS_Handle_SES_Bounce_And_Complaint_Webhooks](#sys_handle_ses_bounce_and_complaint_webhooks)
    - [SYS_Nightly_Backup_Sync](#sys_nightly_backup_sync)
    - [SYS_Continuous_Database_Backup](#sys_continuous_database_backup)
    - [SYS_Cleanup_Static_Asset_Versions](#sys_cleanup_static_asset_versions)
- [8. System Administrator Stories](#8-system-administrator-stories)

# 1. Global Behaviors

The following are general rules for all User Stories, where applicable.

Authentication, roles, and sessions: All stories for Members, Event Organizers, Club Leaders, and Administrators roles assume the user is logged in, has a valid session cookie, and holds the required role(s), membership tier, or special flags. Visitor stories always represent unauthenticated users with no session. System background stories represent automated processes, not logged-in users.

Security and sessions: Authentication uses an HttpOnly, Secure, SameSite=Lax session cookie (JWT). Authenticated state-changing requests must be protected against CSRF and must not perform state changes over GET. The specific CSRF mechanism and request validation rules are defined in the Design Decisions document and must be applied consistently.

Input validation and sanitization: All user-entered text (names, bios, captions, comments, descriptions, etc.) is validated and sanitized to prevent abuse and visual spoofing while remaining usable for international content.

Payment Processing Guarantees: The system does not grant paid access unless Stripe confirms success. Local payment state transitions are monotonic and keyed by Stripe object IDs; duplicates and reordering do not cause double-application. This ordering ensures the system never grants paid features without successful payment. Webhook event processing is idempotent: duplicate webhook deliveries with the same event_id are safely ignored and return 200 OK without reprocessing. This prevents double-processing when Stripe automatically retries webhook delivery. Two payment models are used and each has its own state machine keyed to the appropriate Stripe object:

- One-time payments (membership dues, event registrations, one-time donations): State transitions are keyed by Stripe's payment_intent_id. The enforced state machine is: pending to completed on payment_intent.succeeded; pending to failed on payment_intent.payment_failed; completed to refunded on charge.refunded. Each state transition is recorded in audit logs with timestamp and Stripe event_id. No action is taken on refunds for Phase 1 in any case, so the refund concern is theoretical.

- Recurring donations (Stripe Subscriptions): State transitions are keyed by the Stripe subscription_id and invoice_id. The enforced state machine is: active on customer.subscription.created; active (new payment record created) on invoice.payment_succeeded; past_due on invoice.payment_failed (increments a failure counter; Stripe's configured dunning schedule governs retries); canceled on customer.subscription.deleted (triggered after Stripe exhausts all retries, or when canceled by member or admin). Each subscription event is recorded in audit logs with timestamp and Stripe event_id. All webhook event types are deduplicated via the stripe_events table (keyed on Stripe event_id) regardless of payment model.

Currency: The platform supports multi-currency payments via Stripe. Amounts are stored and displayed in the currency of the original transaction. The `currency` field is recorded on all payment records. Reconciliation and reporting display currency alongside amounts. No currency conversion is performed by the platform; Stripe handles currency settlement.

Security tokens: Email verification tokens and password reset tokens are stored in the database as SHA-256 hashes, never as plaintext, preventing account takeover if the database is compromised. Email verification tokens expire after 24 hours and are marked consumed via a consumed_at timestamp after single use. Password reset tokens expire after one hour due to higher sensitivity. Password reset requests are rate-limited to five requests per email per hour, preventing enumeration attacks that reveal valid emails and token farming. The rate limit applies regardless of whether the email exists in the system, with consistent timing to prevent enumeration via timing analysis. Legacy account claim tokens (`account_claim`) expire after 24 hours (configurable via `account_claim_expiry_hours`), are single-use, and are bound to both the requesting authenticated member account and the imported legacy row being claimed. A claim token may only be consumed while authenticated as the same account that initiated the request.

Privacy, visibility, and moderation: Profiles, club rosters, participant lists, and member search results are member-only unless explicitly stated otherwise. Media galleries and tag gallery pages are public, but uploader details (email/phone, uploaded_by) remain private.

Historical imported people may appear in legacy event results and related read-only historical displays even when they are not current Members. This supports historical accuracy only. It does not imply authenticated-member capabilities, profile ownership, member-search inclusion, club-roster visibility, or any other current-member behavior.

Imported legacy member rows are pre-credential placeholder records created during the one-time migration from the legacy site. They cannot log in, do not appear in member search results or any current-member surface, and do not affect normal registration or password-reset behavior. A legacy member who wants to connect their historical identity and data to a modern account must use the self-serve legacy claim flow while logged in.

Moderation flows favor transparency and human oversight: when members flag content, flagged items remain visible until an administrator reviews and decides; no content is hidden or de-ranked automatically by secret algorithms.

Unless explicitly stated otherwise, all numeric limits (counts, sizes), time windows (expiry/grace periods), reminder offsets, and security thresholds described in this document are defaults and are Administrator-configurable.

Default values and source of truth: Unless explicitly labeled as Example, numeric values in this document are Default values. Defaults for Administrator-configurable system parameters are defined in this User Stories document and must be seeded into the corresponding database-backed configuration data store during initial database creation. The Design Decisions document may describe parameterization, ranges, and ownership, but does not define normative numeric defaults.

All UI labels and system-generated messages are English-only in Phase 1. User-entered club and event descriptions and other club or event details may be authored in any language.

Reporting scope: Any dashboards/metrics described here are operational metrics (health, payment volume, job success/failure), not advanced BI or custom analytics.

When any task is added to the admin work queue, the system sends an email notification to admin-alerts mailing list containing task type and entity ID only (no sensitive member data such as email addresses, payment amounts, personal information, or content details). Queue items can be viewed after resolution with status, admin who resolved, resolution timestamp, decision label, and reason text.

## 1.1 Hashtags

The website will provide organizational structure through explicit linking for uploaded media to club and event galleries based on standardized hashtags, while trusting members to self-organize through freeform tagging. No approval queues. No hidden algorithms. Immediate visibility with automatic discovery. These tags must always follow the de-facto social-platform standard (alphanumeric plus underscores allowed, but not special characters nor hyphens, except for the leading #.)

Hashtags: Tags are short labels that follow the defined tagging pattern: (with a leading “#”) that apply consistently across events, clubs, tutorials, news items, and media. Tag matching is case-insensitive (for example, Footbag and footbag are the same), and all tag-based views behave the same. Common patterns include event tags, club tags, skill or discipline tags, and tutorial. When a member uses a tag anywhere, it automatically contributes to the shared tag index.

*Standardized hashtags* create unambiguous, collision-free categories for media content. Event hashtags follow the pattern `#event_{year}_{event_slug}` (example: #event_2025_beaver_open). Club hashtags follow pattern `#club_{location_slug}` (example: #club_san_francisco). These patterns enforce globally unique identifiers. The system validates standardized tags during event and club creation, scanning existing entities to prevent duplicates. Once created, the standardized hashtag becomes the canonical identifier for that event or club. Members uploading photos or videos can tag content with this hashtag, and the system automatically links that media to the corresponding event or club gallery. This explicit linking solves the discovery problem: organizers create an event (or club) and its standardized hashtag, members tag their uploads, and galleries populate automatically. The connection is direct, predictable, and immediate. Once created, a standardized hashtag is reserved permanently and cannot be reused.

Standardized tags are case-insensitive for usability (#Event_2025_Portland and #event_2025_portland both match) but stored with original capitalization for display quality. Teaching moments appear on the upload page when the member has no uploaded content, showing recent events, the member's club if applicable, and popular community tags to facilitate discovery. When creating an event or club, the UI pre-fills the hashtag field with a suggested value generated from name and location. Users can edit the suggested hashtag before saving. The system validates: format matches pattern, uniqueness via case-insensitive scan, length max 100 characters. Validation happens on save. If hashtag collides, user receives clear error with suggestion to append differentiator.

*Freeform hashtags* complement standardized tags by enabling personal organization without restrictions. Members can tag content with any set of hashtags they choose: #ripwalk, #spike, #tutorial. These tags require no validation beyond security checks (no scripts, no excessive length, no special characters). They create no automatic linking. They exist purely for member-driven discovery and organization. Freeform tags allow organic vocabulary to emerge. If multiple members independently tag similar content with trick-tutorial say, then that becomes a community convention without centralized enforcement. If someone wants to tag photos #best-tricks-2025 for personal reference, they can. The system imposes no taxonomy.

The distinction between standardized and freeform tags is semantic, not technical. Both are simply strings stored in the tags array of a media file. The difference lies in how they function: standardized tags create automatic gallery linking through event/club page scanning, while freeform tags enable browsing and member-driven organization. tutorial tags specifically will be important to complement the website's initial, curated footbag tutorial pages.

Tag Discovery and Browsing: All hashtags throughout the platform appear as clickable links. Clicking any tag navigates to a tag gallery page showing all photos and videos with that tag. A browse-all tags page shows Popular Tags (the most frequently used tags, top N by usage) and All Tags (community tags listed alphabetically).

A community tag is any tag used by at least two distinct members. The browse-all tags page helps new visitors explore user-uploaded content. Tags used only by a single member (even if that member uses the tag many times) are treated as personal tags and are not listed on the /tags browse page. This browsing architecture turns tags into a navigation system, not just metadata. The "/tags" browse page and per-tag gallery pages are public.

The upload interface for media (photos and video links) from the MyContent page never blocks, never enforces. All tag fields start empty. Members can upload media into named galleries with no tags at all, they simply won't appear in event/club or discoverable galleries. This respects member agency while providing clear pathways to proper organization.

Gallery Auto-Linking: When a user loads an event or club media gallery page, the system scans all photo and video metadata looking for matches against that entity's standardized hashtag. This scan operates on metadata only, not full media files, keeping response time as quick as possible.

To keep gallery pages fast, the system may cache gallery scan results. As a result, newly uploaded media or tag edits may take a few minutes to appear on event/club gallery pages.

Gallery pages can lazy-load photos using JavaScript (an optional user experience enhancement). Initial HTML contains metadata and 300×300 pixel thumbnails. JavaScript requests full-resolution images on scroll. Without JavaScript, users see thumbnails and can click through to full images.

Event and club detail pages automatically detect and link to media galleries when content tagged with the standard event or club hashtag exists. Gallery links appear when content exists: View Event Gallery or View Club Gallery. Gallery listings mix photos and videos naturally. This unified approach simplifies the user experience.

Media gallery links appear from club and event pages when content exists (for example, 'View Event Gallery' or 'View Club Gallery'). The system must perform a lightweight scan to detect the existence of just one media item tagged with the event or club hashtag (it does not compute or display image or video total counts). We avoid scans where possible in the UI to keep things quick. All media galleries can include optional external web page URLs, security validated before publication using the full URL validation pipeline used for profile, event, and club URLs.

Content Ownership and Control: Event pages link to galleries showing all photos tagged with that event's hashtag. Member profile pages link to that member's uploaded photos, which may appear in multiple event galleries. The same photo can belong to both the member's personal collection and multiple event/club galleries simultaneously. No duplication. No complex ownership tracking. Just hashtag matching.

Members own their content completely. They can delete photos, videos and named galleries at any time without approval (permanently, no soft delete). A user can nuke an entire named gallery + all media in it in one click (with a UI confirmation given this is permanent). Deletion removes all the content immediately (but requires some minutes to be visibly changed in the UI due to AWS CloudFront CDN caching, and possibly a page refresh click).

If a member uploads inappropriate content, any Tier 1+ member can flag it, triggering admin review. The admin can delete the content if it violates policies. Deletion is the only removal mechanism, logged as an admin decision with a reason. No shadow banning. No selective visibility. This creates accountability: admins must justify deletions, and members know their content is either fully public or fully removed.

Members can edit tags after upload. Adding #event_2025_Beaver_Open to a photo three days after initial upload causes that photo to appear in the event gallery. Removing a tag removes the photo from that gallery. These changes typically propagate quickly, but may take a few minutes to appear due to caching.

Security and Validation: The hashtag system implements security at input validation. All hashtags (standardized and freeform) undergo processing before storage: must start with `#`, HTML tags stripped, Unicode normalized (preventing homograph attacks where visually similar characters create different hashtags), control characters removed, length limited to 100 characters, and restricted to letters, numbers, and underscores after the leading `#` (no spaces or punctuation). This happens regardless of whether the tag is standardized or freeform.

Photos (Hosted Content): Members upload photos (JPEG and PNG only; GIF not supported) with security processing in a way the eliminates the need for anti-virus scans as part of the system's tech stack. Each photo is re-encoded at 85% quality, stripped of all EXIF/ICC metadata, and generates two variants: a 300×300 pixel thumbnail and an 800px-width display image (or smaller if the original image is narrower than 800px). Processing occurs synchronously.

Captions, Descriptions and other Text: All user-submitted text fields (captions, descriptions, names) undergo input validation before storage. Input sanitization removes HTML tags and normalizes Unicode to prevent homograph attacks; output encoding via Handlebars templates prevents script execution; length limits enforce practical constraints (captions 500 characters, descriptions 2000 characters, names 100 characters after normalization). This multi-layer approach prevents injection attacks (XSS, CSV formulas, template code) while maintaining usability for legitimate international content.

Videos (External Links): Members submit YouTube or Vimeo links rather than uploading video files. The system validates URL patterns (youtube.com/watch?v=, youtu.be/, vimeo.com/), extracts video IDs via regex, and stores metadata only. Videos stream directly from their hosting platforms, eliminating storage and transcoding complexity.

Both photos and video links support:

- Hashtag tagging for discovery using standardized patterns: events use `#event_{year}_{event_slug}` clubs use `#club_{location_slug}`. This standardized hashtag uniqueness is enforced via database UNIQUE constraints.
- Captions (plain text, max 500 characters after Unicode normalization; HTML tags stripped, special characters encoded, control characters removed).
- Personal galleries with optional naming.
- Event galleries via hashtag matching with automatic linking.
- Club galleries via hashtag matching with automatic linking.
- Identical problematic content flagging and admin review workflows.
- Members can organize photos and videos into multiple named galleries for custom content organization, as well as using hashtags.

## 1.2 Official Rules for Member Tiers

The following is the single source of truth for tier meanings, eligibility, expiry/extension rules, roster authority, and dues. Membership-related user stories must implement these rules and should avoid re-stating tier definitions except where needed for UI behavior, validations, side effects, or audit requirements. These rules are re-stated from official IFPA documents.

IFPA Membership Rules (Normative):

Tier 0 (non-voting member at large):

- Members of footbag.org are automatically Tier 0 members and can access footbag.org member-only areas (e.g., member search, adding/editing clubs on the club list, member forum, etc.).
- Tier 0 members cannot vote in IFPA elections, run for IFPA offices, sit on IFPA committees, or be counted in the official IFPA member roster.
- Anyone can become Tier 0 by registering a free footbag.org account. Tier 0 does not expire (members may request account cancellation).

Tier 1 (basic IFPA membership):

- Tier 1 members may vote in IFPA elections, participate on IFPA committees, and access IFPA-member-only areas of footbag.org (e.g., video/photo upload service, create/participate in online groups/committees, etc.).
- Tier 1 can be attained free of charge by: (a) attending any IFPA-sanctioned tournament or festival (automatically extends Tier 1 Annual for 365 days from event date when organizer marks attendance), or (b) receiving vouching/recognition from a Tier 2+ member. Vouching pathway (b) is explicitly available to non-competitors and does not require event attendance. Tier 2+ members can vouch for their own club members, and community volunteers. Vouching is available either through direct roster access (after uploading results for sanctioned events) or via request to Administrators at any time.

Tier 2 (IFPA organizer membership):

- Tier 2 members receive all Tier 1 benefits plus organizer privileges: ability to apply for event sanctioning, event sponsorship, send emails to [announce@footbag.org](mailto:announce@footbag.org), add events to the event list, and access organizer-only areas of footbag.org.
- Direct roster access for Tier 2 is normally available only for a limited window after uploading results for a sanctioned event they are organizing (default: 14 days after results upload, Administrator-configurable). All other times, Tier 2 members must request updates from the Membership Director (or an empowered official), who may deny frivolous/abusive requests.
- Becoming Tier 2 requires paying either an annual membership fee or a lifetime membership fee.
- Tier 2 members have limited access to update the IFPA membership roster by designating other members as Tier 1 members via two mechanisms: (a) Direct roster access: Available automatically after uploading results for sanctioned events they are organizing. Access remains open for an Administrator-configurable duration (default: 14 days after results upload) to allow organizers to mark attendance and vouch for participants. During this window, the organizer can use a web-based roster tool to recognize members as Tier 1 Annual. (b) Request to Administrators: Available at any time outside direct roster access periods. Tier 2+ members submit recognition requests via the platform. Administrators review and approve/deny requests acting with offline consent from the Membership Director (external to platform). Administrators have discretion to deny requests that appear frivolous or abusive. All requests, approvals, and denials are audit-logged.

Tier 3 (IFPA director):

- Tier 3 members have all Tier 2 privileges plus direct access to the IFPA membership roster and board-level voting privileges (per IFPA By-Laws). Tier 3 is assigned via elected/appointed offices (not purchasable).

Membership dues and lifecycle (as currently adopted):

- Tier 0: free; no expiry.
- Tier 1: Annual is free; Lifetime is paid (default 10).
- Tier 2: Annual is paid (default 25); Lifetime is paid (default 150).
- Tier 3: (flag set by Admin only); not dues-based.
- Tier 1 Annual (free) eligibility + extension: a unique member may not be listed on the roster more than once; attending any IFPA-sanctioned footbag event extends Tier 1 membership for 365 days from the date of the event.
- Tier 1 Annual via recognition: a Tier 2+ member may recognize ("vouch for") a Tier 1 Annual member for a period not to exceed one year from the date of recognition. Recognition extends the member's Tier 1 Annual expiry to a maximum of 365 days from the recognition date; it cannot extend beyond this one-year limit. Clarification (IFPA-aligned): Tier 1 Annual membership is a free status, attained via sanctioned-event attendance or Tier 2+ recognition or vouching, and is not a purchasable product. The paid Tier 1 option is Tier 1 Lifetime only, cost default (normative): $10.
- Ever-paid dues ⇒ Tier 1 for life: if anyone ever paid membership dues to IFPA (including Tier 2 dues), they become a Tier 1 lifetime member immediately. If Tier 2 lapses, the member remains Tier 1.

Implementation Notes:

- Annual tiers track expiry using tierExpiryDate; lifetime tiers have no expiry.
- “Official IFPA roster” views/counts must filter to Tier 1+; Tier 0 accounts are not counted in the official roster.
- Dues amounts are stored as admin configuration with audit trail and effective dates, updated only when official rules change (see Admin configuration story). Completed payments are not retroactively altered.
- Feature access is controlled by membership tiers and contextual roles / flags (Event Organizer, Club Leader, Administrator, HoF, BAP). Access lines on each story state which tiers and roles may use that feature. These values can be fetched from the database on any authenticated request to check authorization rules. JWT tier or flag claims are cached for routing performance but are never authoritative for access control decisions.
- Hall of Fame (HoF): Permanent honor badge.
- Big Add Posse (BAP): Permanent honor badge.
- Board Members: Tier 3 status (IFPA directors) while serving on the board. When Board flag is active, member is Tier 3; when Board flag is removed, member reverts to their underlying paid tier.
- Site Administrators: Must be IFPA members (Tier 2 Lifetime or Tier 3).
- Official IFPA Roster is defined as the count and listing of members with Tier 1+ status only. Tier 0 accounts are excluded from all official roster views, counts, reports, and exports. Administrator dashboards and reports that display "official roster count" must filter to Tier 1+ members only. Member counts displayed to the public (if any) must clearly indicate whether they represent "all registered accounts" (including Tier 0) or "official IFPA members" (Tier 1+ only).
- Canonical tier status database string values (used in code and SQL; display names are separate): `tier0`, `tier1_annual`, `tier1_lifetime`, `tier2_annual`, `tier2_lifetime`, `tier3`. These exact strings must be used consistently in all database queries, success criteria, and service-layer comparisons. Display text ("Tier 1 Annual", "Tier 2 Lifetime", etc.) is formatted separately in UI templates.

# 2. Visitor Stories

Visitors are unauthenticated users. Visitors can browse public content including clubs, events, news, media galleries, and tutorials. To register for events, upload media, join clubs, view the historical archive, or vote, visitors must register for an account.

## 2.1 Content Discovery

### V_Browse_Static_Content

Access: Any visitor can browse the main Footbag website at footbag.org.

Story: As a visitor, I can browse the main Footbag website’s public content.

Success Criteria:

- The modernized Footbag website is served as the primary footbag.org site; visitors can access it without logging in.
- The legacy footbag.org content is preserved as a read-only static archive at archive.footbag.org for authenticated members only.
- The current footbagworldwide.com implementation is the basis of the new and improved footbag.org; domain and URL details for the final layout are deferred to the detailed design document.
- Visitors can follow standard navigation (home, clubs, events, media) without leaving the modernized site. If they click “Legacy Archive,” they are redirected to register/log in; only members can proceed to archive.footbag.org.

### V_Browse_Clubs

Access: Any visitor can browse the public clubs directory. Only authenticated members can see club member rosters and contact details.

Story: As a visitor, I want to browse the clubs directory by country/state/city so that I can discover local clubs (but I cannot see the list of club members).

Success Criteria:

- The system provides a clubs landing view with geographic drill-down navigation (Country, State/Province, City) with club names and member counts.
- Only members can view club member rosters and contact details.

### V_Browse_Upcoming_Events

Access: Any visitor can browse upcoming events and open public event detail pages for publicly visible event statuses. Only authenticated members can register or see member-only organizer contact details. 

Story: As a visitor, I want to browse upcoming events and open their public detail pages so that I can plan participation. 

Success Criteria: 

- Main events landing page shows upcoming public events sorted by start date.
- Each upcoming event card shows the fields needed for public browsing: title, date range, location, host club, description when present, and registration status.
- Each publicly visible upcoming event links to the canonical public event page at `GET /events/:eventKey`.
- Public canonical event pages are available only for events with status `published`, `registration_full`, `closed`, or `completed`.
- Events with status `draft`, `pending_approval`, or `canceled` do not have public detail visibility.
- Organizer contact details, registration actions, payment actions, and member-only state are excluded from this public slice.

### V_Browse_Past_Events

Access: Any visitor can browse past events, view whole-year public results pages, and drill down to canonical public event pages. 

Story: As a visitor, I want to browse past events and their results by year, and then click through to a specific event when I want the event-focused page. 

Success Criteria: 

- The public events landing page shows archive-year links derived from completed public events, showing all years with events in a side list for easy access to a given year. The default year for the landing page is the current year (for example: 2026). Every year page has navigation between that year and previous or next years when those adjacent years contain completed public events.
- All historic events are viewed grouped by year (one page per year), with events sorted by start date. The year page shows the full completed public event list for the selected year even when some events do not have results.
- The year page at `GET /events/year/:year` is a whole-year archive/results page. It is not paginated. The list of events for any given year is short enough that it does not need UI pagination.
- Each year-page event block shows the public summary fields required for browsing historic events: title, date, location, host club when known, description when present, and the standardized event hashtag / canonical key when available.
- The year page shows event summaries only; results are on the canonical event detail page at `GET /events/:eventKey`.
- When no result rows exist for a completed public event, the year page still shows the event; the event detail page explicitly indicates that no results are available yet.
- Each completed public event also has a canonical public page at `GET /events/:eventKey` for event-focused viewing and direct linking.
- If a historical event page is opened and no result rows exist for that event, the page still shows the event and explicitly notes that no results are available yet.
- Public canonical event pages are available only for events with status `published`, `registration_full`, `closed`, or `completed`.
- Events with status `draft`, `pending_approval`, or `canceled` do not have public detail visibility.
- Legacy archive content at `archive.footbag.org` is a separate repository and the historical event and results data hosted there must not be conflated with the public event browsing pages described here. Everything on `archive.footbag.org` is irrelevant to the canonical event/results route contract.

### V_View_News_Feed

Access: Any visitor can read the main news feed.

Story: As a visitor, I want to read the news feed so that I stay informed.

Success Criteria:

- Auto-generated chronological feed of upcoming events, event results published, new clubs, new Hall of Fame (HoF) members, new Big Add Posse (BAP) members, vote results, and any other IFPA announcements.
- The system provides a news view grouped by year, with navigation between current and previous years and one year's news per page.
- Each news feed item is backed by a NewsItem record that links to a specific underlying entity (for example an event, club, member, vote, or announcement).
- NewsItems are created or updated automatically as side effects of those primary flows (e.g., when an event is published, results are posted, a club is created or archived, HoF/BAP/Board Member status is granted, or vote results are published). Admins can create or edit news stories (see separate story below).

### V_View_Tutorials

Access: Any visitor can view tutorials and informational content without logging in.

Story: As a visitor, I can view tutorials, rules, and other reference material so that I learn the sport.

Success Criteria:

- Initial educational pages (trick tutorials, rules, equipment guides, etc.) are static content.
- Developers provide initial content as static files for the website.
- Members can create their own tutorial galleries freely using photo and video upload features with descriptive captions, hashtags, and named galleries (suggest hashtag tutorial among others). Visitors can view this content too.

### V_View_Gallery

Access: Any visitor can view media galleries.

Story: As a visitor, I can view media gallery pages for a given hashtag (or list of hashtags) so that I see all media matching the tag(s). The public View Media landing page will facilitate discovery of popular hashtags, recent events, and tutorials.

Success Criteria:

- Gallery built dynamically based on tag matching. One gallery page will display all photos and videos matching specified freeform or standardized hashtags.
- Gallery header page displays tag names with proper capitalization, count of total media items.
- Gallery grid shows standard photo/video layout.
- Each gallery item displays thumbnail, caption excerpt, all clickable tags, upload date.
- Empty state displays "No photos or videos found with this tag" with suggestions of 5 popular tags platform-wide (a teachable moment).
- Media galleries are pubic, but only logged-in members will see details about the personal information of the member who uploaded the media (uploaded_by).

### V_Browse_Hashtags

Access: Any visitor can browse standardized and freeform hashtags on the public Browse Hashtags page and see public content tagged with them. This page will always highlight popular hashtags, recent events, and tutorials.

Story: As a visitor, I can browse all freeform and standard hashtags so that I discover content vocabulary without searching.

Success Criteria:

- Popular Tags section displays the most frequently used community tags (top 30 by usage across the site).
- Recent events and tutorial will be given special treatment to facilitate discovery.
- This feature lists only Community Tags: tags that have been used by at least two distinct members. Personal Tags (used by only one member) remain private to that member's gallery and are not listed on public Browse Hashtags page. Background job recomputes tag usage statistics daily, identifying community tags by counting distinct member IDs per tag. Popular Tags section shows top 30 community tags by count of distinct members who have used them.

### V_Access_Denied
Access: Any user. This is an exceptional error user story. It should only happen if there is a system bug, because no User Interface field should ever be available for any user to click on if they are not both authorized and authenticated (active session).

Story: As a user, if I attempt an action I’m not permitted to perform, I see a clear Access Denied page so I understand what happened and recover.

Example authorization flags are: Tier0, Tier1, Tier2, Tier3 (equivalent to IFPA_Board semantically), Admin, Event_Organizer, Club_Leader, HoF, BAP. This list is not exclusive, as other User Stories may define other critera for accessing content.

Success Criteria:

- Returns an Access Denied page with a short explanation and a link back to a safe page (e.g., dashboard or home).
- Does not reveal private data.

### V_Not_Found

Access: Any user. This is an exceptional error user story. It should only happen if there is a system bug, because no User Interface field should ever lead to an unknown URL.

Story: As a user, if I navigate to an unknown URL (404 HTTP code), I see a clear Not Found page so I can I understand what happened and recover.

Success Criteria:

- Returns an Not Found page with a short explanation and a link back to a safe page (e.g., dashboard or home).
- Does not reveal private data.

### V_Error_or_Maintenance_Mode
Access: Any user. This is an exceptional error user story. It should only happen if there is a system bug.

Story: As a user, if the system is down or encounters an internal error (50x HTTP code), I see a clear error/maintenance page so I know the issue is not my fault.

Success Criteria:

- Shows a friendly error message with next steps (retry later, contact link).
- Does not reveal stack traces or sensitive internals.

### V_Register_Account

Access: Visitors who are not logged in can create an account. A successful registration creates a new member (Tier 0, free lifetime).

Story: As a visitor, I can register with email, password, real full name, real location, and display name so that I can become a member.

Success Criteria:

- New member registration with email verification.
- This registration MUST use the human’s real and full name, spelled out and capitalized correctly, with no initials or abbreviations. Bogus registrations that do not follow this rule, upon discovery, will be deleted.
- This registration MUST use the human’s city, state, country. USA members must use the official two-letter state name (eg: CO, CA, NY).
- System sends verification email.
- After clicking link, user can log in and create profile.
- Email must be unique across all members including accounts in their deletion grace period (reuse only after the grace period completes and PII is cleared).
- Registration enforces email uniqueness. If a submitted email belongs to an account currently in its deletion grace period, the response is identical to a successful new registration. No indication is given that the email is reserved, preventing account-existence enumeration via the registration flow.
- Display names are constrained to prevent homograph attacks (for example: no mixed scripts or confusable characters, and reasonable length limits).
- New members automatically assigned Tier 0 (free lifetime) status.
- Member sees a clear success message after registration: "Registration successful! Please check your email to verify your account."
- Member sees clear error messages for validation failures with hints about what to fix.
- Passwords are stored securely using one-way hashing; they are never stored or logged in plaintext.
- Password Requirements: Minimum 8 characters, maximum 128 characters, no complexity requirements to allow passphrases.
- Password Validation: Client-side validation provides immediate feedback, server-side validation provides authoritative enforcement.
- If registration validation detects rule violations at registration time (invalid format, prohibited characters, not using a full name), the system rejects registration immediately with clear error message. Admin deletion authority is for cases where invalid registrations pass initial validation and are discovered later through manual review or reports.

# 3. Member Stories

Members are authenticated users who have completed email verification. All new members start at Tier 0 (free, lifetime). Members can upgrade to Tier 1 or Tier 2 to unlock additional features. Members can hold multiple contextual roles simultaneously: a member can organize events (Event Organizer) and lead a club (Club Leader) without separate accounts. Tier 3 is reserved for Board Members only.

Important note: All stories below (except for M_Login) assume that the member has an active authenticated session for access.

## 3.1 Account Lifecycle

### M_Login

Access: All members with a verified email can log in with email and password.

Story: As a member, I can log in and receive a secure session cookie so that I can use member features.

Success Criteria:

- Logging in is only allowed after email verification is complete.
- Login attempts are rate-limited using a simple fixed-window limiter keyed by IP address and email/account identifier. Thresholds, windows, and cooldown durations are Administrator-configurable (safe defaults).
- Member sees clear error message for failed login: "Invalid email or password. Please try again.".
- Member sees success confirmation after login.
- On successful login, the system issues the authenticated session (HttpOnly, Secure, SameSite=Lax session cookie).
- Individual failed login attempts are not persisted to the audit log. When the login rate limit threshold is crossed, a single audit log entry is created recording that the threshold was exceeded for the given account identifier (no IP address stored). This preserves the privacy-first audit log design while retaining security traceability.

### M_Reset_Password

Access: Members with a registered email can request a password reset.

Story: As a member, I can request a password reset so that I can recover access.

Success Criteria:

- Reset link valid for an Administrator-configurable duration (default: one hour).
- Reset link implemented as a single-use, unguessable token that is invalidated after use or expiration.
- Password reset responses do not reveal whether an email is registered (enumeration-safe message such as "If an account exists for this email, a password reset link has been sent.").
- Password reset requests are rate-limited per email and IP address to mitigate abuse.
- Once used, old password invalidated.
- Passwords are stored securely using one-way hashing; they are never stored or logged in plaintext.
- passwordVersion field incremented for immediate token invalidation.
- Reset token is single-use and invalidated immediately after successful reset or after expiration.
- Member receives a confirmation email that their password has been changed.
- Reset flow follows the same validation and session security assumptions defined in Global Behaviors and Constraints (sanitization, secure session handling, etc.).

### M_Change_Password

Access: Logged-in members can change their password while authenticated (different from M_Reset_Password which is for forgotten passwords).

Story: As a member, I can change my password while logged in so that I can update my credentials for security reasons.

Success Criteria:

- Change password form requires: current password (for verification), new password, confirm new password.
- System validates that current password is correct before allowing change.
- New password must meet the same security requirements as registration (minimum length, complexity as defined in validation rules).
- System validates that new password matches confirmation field.
- On successful password change: passwordVersion field is incremented (invalidates all existing JWT sessions immediately), new password hash replaces old password hash, member receives confirmation email at verified email address, member sees success message.
- Current device stays logged in because the system issues a new session JWT (with updated passwordVersion) immediately after the password change; all other sessions become invalid.
- All other active sessions on other devices are immediately invalidated (due to passwordVersion increment).
- On failure: clear error messages guide the member: "Current password is incorrect" (if current password wrong), "New password does not meet requirements: specific requirements" (if validation fails), "Passwords do not match" (if new and confirm don't match).
- Failed change password attempts are rate-limited per member account to prevent brute-force attacks on current password verification (same rate limiting as login).
- All password changes audit-logged with member ID, timestamp (but never log actual passwords).
- Passwords are stored securely using one-way hashing with argon2id; they are never stored or logged in plaintext.

### M_Logout
Access: Logged-in members.

Story: As a member, I can log out so that my current session ends and the site no longer treats me as authenticated.

Success Criteria:

- Logout action clears the authentication session cookie.
- After logout, any attempt to access member-only pages redirects to login page.
- Member sees a clear confirmation message that they are logged out.

### M_Delete_Account

Access: Members can request to delete their own account. Notable exception: HoF and BAP members will always be preserved on the site to preserve history. These members will be allowed to delete their accounts for personal and data privacy reasons, but special rules will apply to their names and brief bios.

Story: As a member, I can delete my account so that I can leave the platform.

Success Criteria:

- Member can request account deletion from their profile page.
- System explains the deletion consequences and the grace period before permanent deletion (account enters a grace-period deletion state; Administrator-configurable grace period length).
- After confirmation, the account enters a deleted state; member cannot log in or use the site, except to restore the account within the grace period.
- After deletion, member no longer appears in member search results or active member lists. Historical records (e.g., past event results, archives, and logs) preserve the member as a non-clickable “Deleted Member” placeholder to maintain history and data referential integrity.
- Members with HoF or BAP flags receive special treatment during deletion. Admin-configurable soft-delete grace period applies. After this grace period expires: email/phone/passwordHash removed like all members, but displayName and bio fields are always preserved regardless of deletion. Deleted HoF/BAP profiles continue showing: special status badges (HoF or BAP flag), preserved displayName (not changed to "Deleted Member"), preserved bio text, memberId for referential integrity. Historical event results, leadership records, and community contributions remain attributed to these members by preserved displayName. This preserves community history and honors that are meant to be permanent regardless of account status.
- Financial and audit records anonymized after the configured grace period. Transaction IDs retained for a configurable compliance period (default: 7 years).
- Audit logs retain for a configurable compliance period (default: 7 years) with no personal identifiers (except member id).
- Attempts to access the profile of a member in the deletion grace period show "Account not found" message, but this would be an exceptional error case, as links to deleted members should not be shown.
- Media uploaded by deleted member is deleted immediately (no soft delete for photo data).
- Member receives email confirmation of the deletion request and information about how to restore the account during the grace period.
- Member sees clear confirmation message before deletion that includes the configured grace period value (for example, this might be: 90 days), e.g.: "You can restore it within {gracePeriodDays} days by logging in."
- Member sees success message after deletion that includes the admin-configured grace period value, e.g.: "Account deleted. You have {gracePeriodDays} days to restore by logging in."
- If the member was the only leader of a club or the only event organizer, the affected club/event is flagged for admin review and added to an admin work queue using the appropriate queue label: clubs use “Needs Leader” (and, if the club also lacks a contact email, “Needs Contact”), while events use “Needs Organizer”.
- Photo deletion from S3 occurs synchronously during the account deletion request. If S3 deletion fails, the deletion request fails and the member account is NOT deleted (transactional consistency: the account is only marked deleted after all photos are confirmed removed from S3).
- Named gallery records belonging to the deleted member are hard-deleted when the member's photos are deleted. Gallery rows have no downstream referential integrity concerns (they are leaf nodes). Gallery deletion is part of the same atomic operation as photo deletion.

### M_Restore_Account

Access: Members whose accounts are within the deletion grace period can restore their account by logging in.

Story: As a member who has requested account deletion, I can log in within the grace period to restore my account so that I can reverse an accidental or regretted deletion.

Success Criteria:

- During the grace period, the login flow detects that valid credentials belong to an account in a deleted state (deleted_at IS NOT NULL, grace period not yet expired).
- The system presents a restoration confirmation screen — not the normal dashboard — explaining the account is pending deletion and asking whether to restore it.
- If the member confirms restoration, the system clears deleted_at, reinstates the account to active status, and logs the restoration in the audit log with actor, timestamp, and action type.
- If the member dismisses the screen without confirming, they are not logged in and the account remains in its deleted state.
- After restoration, the member is redirected to the normal post-login destination and sees a success message: "Your account has been restored."
- Restoration is only available within the configured grace period (member_cleanup_grace_days). After that period expires and PII has been purged, login is permanently rejected.
- Restoration is audit-logged with member ID and timestamp.

### M_Download_Data

Access: Members can request a download of their own personal data and account records.

Story: As a member, I can download all my personal data as JSON so that I can exercise my data rights (provided by GDPR data privacy rules).

Success Criteria:

- Member can request a personal data export from their profile page.
- The system generates a JSON export that includes: Member profile data (identity, contact, membership tier, etc.). Payment history associated with the member. Event registrations and participation data. Media metadata uploaded by the member (e.g., file names, timestamps, captions, tags). Audit log entries where the member is the actor.
- Vote data in the export: Indicates which votes the member participated in and relevant metadata (vote title, vote ID, submission timestamp). Does not include raw ballot content, receipt tokens, or receipt token hashes. Members who need to verify a ballot must use the receipt information from their original vote-confirmation email; the system does not store plaintext receipt tokens.
- The data export is delivered as a human-readable JSON file with a documented structure.
- Export contents include: member profile, tier status, email subscription settings, club memberships/roles, event registrations, uploaded media metadata owned by the member (including tags/captions/links), payment history entries that reference the member, and vote participation records (but never vote selections).
- Delivery: Member clicks an Export My Data link from their dashboard page, and the system generates a file and provides a time-limited download link (expires after the configured duration, default 72 hours, keyed by `data_export_link_expiry_hours`), and also emails the same link to the member's verified email address.

### M_Browse_Legacy_Archive

Access: Members can access the read-only legacy content at archive.footbag.org. Visitors cannot access the archive because it contains private member data.

Story: As a member, I can browse the historical archive of the old footbag.org site so that I can access content (especially media) that has not been migrated into the new system.

Success Criteria:

- After logging into the main site, a member can click a clearly labeled "Legacy Archive" link.
- The member is transparently authenticated to the legacy archive and can browse historical content without re-entering credentials.
- Legacy archive access is gated by the main site session JWT. Access expires when the main site JWT expires. The JWT expiry duration is Administrator-configurable (default: 24 hours, keyed by `jwt_expiry_hours`). No separate archive session token is issued; the platform validates the member's session transparently at the archive edge.
- If the member's session expires, attempts to use the archive cause a redirect back to the main site login.
- Direct access attempts to the legacy archive by unauthenticated users redirect to the main site login with a suitable message.
- The legacy archive is read-only, static HTML content (no DB or JavaScript).
- The archive preserves the historical structure and content of the old footbag.org site as closely as practical (pages, articles, event reports, and media that were mirrored). Notably however, all videos (many of which had old, obsolete video formats) have been converted to .mp4 format, and all images have been converted to .jpg.
- Archive search is not provided and no new content is added to the archive (it is strictly historical).
- From the member's perspective, the main site is the primary place for new content and participation; the archive is explicitly presented as historical reference only.
- Security note: Archive access does not perform the passwordVersion check used by the main site (this check requires a database query unavailable at the CloudFront edge). A password change does not immediately revoke archive access; archive access expires naturally when the JWT expires (up to jwt_expiry_hours, default 24 hours). This is an accepted operational trade-off.

### M_Claim_Legacy_Account

Access: Logged-in members.

Story: As a logged-in member, I can link my legacy footbag.org member record to my current account so that my historical identity, honors, migrated profile data, and relevant club affiliations are associated with my real modern account.

Success Criteria:

- Member can access a Link Legacy Account flow from their profile settings.
- Member enters one identifier: legacy email address, legacy username, or legacy member ID.
- If an eligible imported row is found, the system emails a time-limited claim link to that row's legacy email address. The response never reveals whether the identifier matched zero rows, multiple rows, a blocked row, or a row without a usable email address. Recommended message: "If an eligible legacy record was found, a claim email will be sent."
- The claim link is single-use, time-limited (Administrator-configurable, default 24 hours, keyed by `account_claim_expiry_hours`), and may only be consumed while logged into the same account that initiated the request.
- Claim initiation and resend are rate-limited per requesting account, per target imported row, and per session/IP.
- Before merge, the system shows a final confirmation screen identifying the active account that will receive the legacy identity.
- If mirror-derived club affiliation suggestions or provisional bootstrap leadership suggestions exist for the claimed identity, the member is prompted to review them before confirming (see M_Review_Legacy_Club_Data_During_Claim).
- On confirmation, the merge runs atomically: transfers `legacy_member_id`; merges allowed profile fields (import fills only if active value is empty or absent; active account always wins for credentials, display name, and contact fields); applies tier adjustment if imported effective tier exceeds current (ledger entry only); writes confirmed club affiliations; may promote confirmed provisional leadership into live club leadership; deletes the imported placeholder row.
- All claim and merge events are audit-logged.
- If self-serve claim is not available (no usable legacy email, row flagged for review, or other ineligibility), the member is directed to contact an admin for manual recovery.

### M_Review_Legacy_Club_Data_During_Claim

Access: Logged-in members in the legacy claim flow.

Story: As a member claiming my legacy account, I can review mirror-derived club suggestions and any provisional legacy leadership so I can confirm or correct club data before the merge is finalized.

Success Criteria:

- When staged club or bootstrap leadership suggestions exist for the claimant's legacy identity, the claim flow presents them before the final merge confirmation.
- Each suggestion shows the best available club identity and inferred role.
- Member can mark each suggestion: current club, former-only, not mine, or needs admin review.
- Member can confirm or reject provisional contact-email assignment.
- Member can confirm or reject provisional leader or co-leader status.
- Confirmed current affiliation writes to `member_club_affiliations`; if the member already has a current club affiliation, the previous one is converted to former in the same transaction.
- Confirmed leadership may promote the bootstrap row into a live `club_leaders` row when no conflicting live leader exists; otherwise it remains provisional and is flagged for admin review.
- Former-only, not-mine, and needs-review outcomes are persisted so the member is not repeatedly prompted.

## 3.2 Profile Management

### M_Edit_Profile

Access: Members can edit their own profile information, subject to validation rules.

Story: As a member, I can view and edit my profile (display name, bio, avatar, contact prefs, external URLs) so that others see accurate info.

Success Criteria:

- Member profile creation and editing (photo, bio, contact preferences).
- City, country, and email are mandatory fields; phone is optional.
- Member search is authenticated members only (Tier 0+) — never public. Search results show display name and country only; email and contact fields are never exposed in search results.
- Public visibility (visible to all including visitors): Events list, news feed, public galleries (if explicitly marked public).
- Members-only visibility (visible to logged-in members): Member profiles, club rosters, event participant lists, member search results.
- Private visibility (visible only to owner or admins): Email addresses (unless member opts in), payment history, audit records.
- Tier badges visible to logged-in members on: profiles, club rosters, event participant lists, search results, media author info.
- Tier badges NOT visible to anonymous visitors.
- External URLs on profiles (maximum 3) are validated before publication and presented safely (e.g., clearly labeled and protected against malicious links).
- Key actions are recorded in the audit log.
- Member profile will automatically show club affiliation, media galleries, and links to event results, if participated.
- Display names are constrained to prevent homograph attacks (for example: no mixed scripts or confusable characters, and reasonable length limits).

### M_Search_Members

Access: Members an search for other members within the visibility and privacy rules.

Story: As a member, I want to search for other members by name so that I can find and connect with other players in the community.

Success Criteria:

- Search by Display Name.
- Support prefix matching (e.g., "jane" matches "Jane Doe").
- Minimum 2-character query length; maximum 20 results per page.
- Members may opt out via `searchable: false` profile flag. `searchable` means eligible for authenticated member lookup only — it does not mean publicly discoverable or contactable.
- Search results exclude: (a) members with `searchable: false`, (b) members currently in the deletion grace period (account deleted but not yet purged), and (c) deceased members. Only active members with `searchable: true` are returned.
- Broad queries return a capped result set with a "refine your query" prompt; no exhaustive browse-all or full pagination.
- This is the only member search feature. It is authenticated-only and deliberately narrowing — not a member directory.

### M_View_Profile

Access: Members can view other members' profiles according to each profile's visibility settings.

Story: As a member, I can view member profiles so that I learn about other members or see how my own profile appears to others.

Success Criteria:

- Member can view any member profile (own or others).
- Profile displays: photo, display name, city, country, bio, tier badge, external URLs, club affiliation (if any).
- Email address shown only if: (viewer is profile owner) OR (profile owner opted in to email visibility).
- Tier badges visible to logged-in members only on profiles, club rosters, event participant lists, search results, media author info. Honor badges such as Hall of Fame (HoF), Big Add Posse (BAP), and Board Member are visible to all users (including visitors) wherever the member appears.
- Profile shows member's uploaded photos and videos in thumbnail grid.
- When viewing own profile: link to edit profile, clear indication of current tier status and expiry date (if applicable).
- When viewing other profile: no access to private information (payment history, audit logs).

## 3.3 Club Membership

### M_Join_Club

Access: Members can join one club.

Story: As a member, I can join one club so that I appear on its roster.

Success Criteria:

- Only one club membership allowed at a time. If member joins a new (second) club, the system automatically removes member from old club. In this case the UI will have a clear message to the user.
- Club roster retrieved by aggregating members where clubId matches.
- Club member roster visible to all logged-in members (not visitors).
- Roster shows member display name, tier badge, any special flags (HoF, BAP, Board), and city/country.
- Roster does NOT show member email addresses unless member has opted in to email visibility.
- Joining sends an email notification to the member, and all Club Leaders. If the member was automatically removed from a previous club, then this will be noted in the email.

### M_Leave_Club

Access: Members can leave a club they currently belong to.

Story: As a member, I can leave my current club to be removed from the roster.

Success Criteria:

- Leaving sends an email notification to member, and all Club Leaders.

### M_View_Club

Access: Members can view full club details and rosters. Visitors see only public club information.

Story: As a member, I can view club details and member roster so that I learn about clubs and see who belongs. Also I can find the contact information of the Club Leader(s).

Success Criteria:

- Club page displays: club name, logo, description, city, country, contact email(s) for leader(s), external URL (if provided), standardized hashtag.
- Club page shows club member count.
- Member roster shows all members where clubId matches the club.
- Roster displays: member display name, tier badge, city, country.
- Email addresses shown only if member has opted in to email visibility.
- Roster sorted alphabetically by display name.
- Club detail page includes a link to the club media gallery (for example, "View Club Gallery") when at least one media item exists, without showing image or video counts in the link text.
- Leaders array displayed on club detail page showing all current leaders.

## 3.4 Event Participation

### M_Register_For_Event

Access: Members can register for events.

Story: As a member, I can register for an event so that I can participate.

Success Criteria:

- Event registration with participant tracking and (optional) capacity enforcement.
- Registration confirmation email sent to member.
- System confirms registration and sends reminder email one week before event.
- After tournament, member profile will automatically link to event results page (for every event they have participated in that posted results).
- Registration includes a required selection of registration type: Competitor or Attendee/Supporter (if the organizer has enabled both; otherwise the single available type is implied).
- If Competitor: member selects one or more organizer-defined event categories.
- If a selected category is doubles/team: member provides partner/team information (member-select when possible; otherwise free-text).
- If a selected category is mixed doubles: both member profiles must have sex fields populated, one Male and one Female.  Other event categories also require sex fields, such as Women's net. Note that men and women can both play in the Open category.
- If Attendee/Supporter: no categories are required; optional fields may be collected if configured by organizer (e.g., t-shirt size, donation amount).
- Confirmation email includes registration type and selected categories and/or partners (if any).
- Some events are free and others are paid.
- For paid events, the member must complete the Stripe checkout process to be officially registered. Changes are applied only after webhook-confirmed success.
- Event registration payments affect registration status only and do not directly change membership tier.
- When the registered participant count reaches the event's (optional) capacity limit, the event status automatically changes to `registration_full`. Subsequent registration attempts receive the message: "This event has reached capacity and is no longer accepting registrations." No waitlist functionality exists.

### M_View_Event

Access: Members can view their full event details, including their own registration status and member-only information.

Story: As a member, I see my own registered events in two sections: upcoming events and past events with results.

Success Criteria:

- Upcoming Events section shows events where member is registered AND startDate greater than today AND status in (published, registration_full, closed).
- Past Events with Results section shows events where member participated AND the event has published results records.
- Each entry shows event title, date, location, status or placement.
- One-click access to event details, results, and media galleries.
- For events the member is registered for, the event detail view displays the member’s registration type and selected categories/partner info (if applicable).

## 3.5 Payments

### M_Donate

Access: Members can make one-time or recurring donations using the site's Stripe-powered checkout.

Story: As a member, I can make a one-time or recurring annual donation to support IFPA and its activities, optionally including a short comment that will be stored with my donation, so that I can financially support the community and, if I want, include context or a personal note with my contribution.

Success Criteria:

- From my member account, I can open a donations page that clearly shows suggested donation amounts, an optional custom amount field, and whether this donation is one-time or recurring annual before I proceed to payment.
- I can enter an optional short comment or note with my donation (for example: In memory of…). This comment is stored as part of the structured payment record.
- For HoF members, this comment should default to HoF Fund. For BAP members, this comment should default to BAP Fund. If a member is both HoF and BAP, use the HoF default.
- One-time donations use Stripe Checkout so that card details never touch IFPA servers. The payment record stores Stripe payment_intent_id, amount, currency, and status.
- Recurring annual donations use Stripe Subscriptions via Stripe Checkout (with the subscription mode parameter). The system creates or reuses a Stripe Customer object for the member (storing the resulting stripeCustomerId on the member record) and creates a Stripe Subscription billed yearly. The platform stores the Stripe subscription_id and the associated stripeCustomerId in the donation record. The platform does not manage the billing schedule itself; Stripe owns the renewal cycle and retry logic.
- The donation comment is stored in Stripe Subscription metadata and also in the local payment record so that it survives across all subsequent billing cycles.
- For recurring donations, the local database stores: stripeSubscriptionId, stripeCustomerId, status (active, canceled, past_due), the donation amount, currency, interval (yearly), start date, and the donation comment. The platform records each successful charge as a new payment record when the invoice.payment_succeeded webhook is received. No next_charge_date field is maintained by the platform; Stripe owns the schedule.
- After a successful donation setup, I see a clear confirmation message in the UI and receive a confirmation email with amount, date, interval (one-time or yearly recurring), and basic reference information, but not full card details.
- If the payment fails or is canceled during checkout, I see a clear error or cancellation message and no donation record is created.
- I can cancel an active recurring donation from my Payment History page at any time. Cancellation sets the Stripe Subscription to cancel_at_period_end=true so I retain the current period's donation intent and no further charges occur. I see a clear confirmation message and receive a cancellation confirmation email. The local subscription status updates to canceled when the customer.subscription.deleted webhook is received.
- All donation records (including comment, amount, recurrence info, Stripe subscription_id, and stripeCustomerId) are stored in a way that can be aggregated later for reporting, reconciliation, and tax-related exports where applicable.

### M_View_Payment_History

Access: Members can view their own donation and payment history.

Story: As a member, I can see a history of all my payments to IFPA (donations, membership purchases, and event registration fees), including key details and any comments provided for donations, so that I can keep track of what I have paid, reconcile my own records, and confirm that charges are correct.

Success Criteria:

- From my account area, I can open a Payment History page that lists my payments in reverse chronological order.
- The history includes at least: date, type (Donation, Membership, Event Registration, etc.), amount, payment status (succeeded, pending, etc.), and a concise descriptor (for example “Membership: Tier 2 Lifetime”, “Donation: HoF Fund”, “Event Registration: Worlds 2027 – Singles”).
- For donation entries, any comment I provided in the donation flow is visible to me as a “Note” or similar field in the history, so I can confirm that the note was recorded correctly.
- Each payment entry includes a stable payment reference (for example a truncated Stripe payment intent ID or a friendly reference) so that support or admins can correlate my view with internal reconciliation tools.
- Recurring donations are clearly labeled as such, and it is straightforward to distinguish the original subscription setup from subsequent annual renewal charges. Active recurring donations show a Cancel Recurring Donation action. canceled or past_due subscriptions are clearly indicated with their status. The Payment History page does not allow me to edit historical payments, but provides links or obvious instructions for how to get support if I find a problem.

## 3.6 Membership Tiers and Flags

Refer to Official Rules for Member Tiers in section 1.2 above, as all those rules must be enforced in all User Stories given below.

In user stories below, "Access: Tier X+" means the authenticated member's current tier is X or higher. Tier 1 includes all Tier 0 privileges. Tier 2 includes all Tier 1 privileges. Tier 3 includes all Tier 2 privileges.

### M_Purchase_Tier_1

Access: Logged-in members at Tier 0 can use this flow to purchase Tier 1 Lifetime membership. Members who are already Tier 1+ do not see this option.

Story: As a Member, I can upgrade to Tier 1 Lifetime membership by paying 10 through Stripe Checkout so that my account reflects my upgraded status.

Success Criteria:

- Member must be logged in (Tier 0 members can purchase, visitors must register first).
- Member sees a clear "Upgrade to Tier 1 Lifetime" option from their account/dashboard when eligible.
- System creates Stripe Checkout Session with configurable amount.
- Member redirects to Stripe-hosted payment page.
- After successful payment confirmation via Stripe webhook, the account tierStatus changes and this is visible in the profile and dashboard. Tier changes are applied only after webhook-confirmed success.
- If payment fails or is canceled, tier does not change and member sees a clear error message explaining that the upgrade did not complete.
- Payment confirmation email sent to member.
- Payment appears in member's payment history with note to explain.
- All payment events are audit-logged.
- Member sees a clear success message when the action completes successfully, including next steps: Tier 1 Lifetime activated! You can now vote in IFPA elections, participate on IFPA committees, and access IFPA-member-only areas of footbag.org.
- Member sees a clear error message when the action fails.

### M_Purchase_Tier_2

Access: Members (Tier 0+) can purchase Tier 2 Annual or Tier 2 Lifetime membership. Visitors must register for an account to become a Tier 0 member before purchasing.

Story: As a Member, I can purchase Tier 2 membership (defaults to annual for 25/year or lifetime for 150) so that I can access Tier 2 benefits.

Success Criteria:

- Member must be logged in (Tier 0 or Tier 1 members can purchase, visitors must register first).
- Member can select Tier 2 Annual (default 25/year) or Tier 2 Lifetime (default 150).
- System creates Stripe Checkout Session with appropriate amount.
- Member redirects to Stripe-hosted payment page.
- After successful payment confirmation via Stripe webhook: For Tier 2 Annual: tierStatus becomes `tier2_annual`, tierExpiryDate set to max(today, current tierExpiryDate) + 365 days. This means early renewals extend from the current expiry date, not the purchase date. If the member has no active Tier 2 Annual (i.e., their tier has already expired), the new expiry is 365 days from today.
Tier changes are applied only after webhook-confirmed success.
- In all cases, a successful Tier 2 payment (Annual or Lifetime) permanently establishes Tier 1 Lifetime as the fallback tier for that member. This means if Tier 2 Annual later expires, the member falls back to Tier 1 Lifetime without gap (not Tier 0). The fallback transition occurs atomically during the SYS_Check_Tier_Expiry job; there is no period where the member has neither Tier 2 nor Tier 1 status.
- If the member already holds Tier 1 Lifetime, Tier 1 remains as a fallback tier: when Tier 2 Annual expires, Tier 1 Lifetime status remains in effect and visible (else the fallback is Tier 0).
- Tier 2 status becomes active immediately, with visible start date and expiry date (for annual).
- If payment fails or is canceled, Tier 2 tier does not change and a clear error message is shown.
- Payment confirmation email sent to member.
- Payment appears in member's payment history labeled "Membership: Tier 2 Annual" or "Membership: Tier 2 Lifetime".
- All payment events are audit-logged.
- Member sees a clear success message when the action completes successfully, including next steps: Tier 2 activated! You can now access organizer features, including applying for event sanctioning, requesting sponsorship, sending community announcements to [announce@footbag.org](mailto:announce@footbag.org), and accessing organizer-only areas of footbag.org.
- Member sees a clear error message when the action fails.

### M_View_Tier_Status

Access: Members can view their current tier and relevant dates (such as Tier 2 Annual expiry).

Story: As a Member, I can view my current membership tier, my tier-related benefits, and any expiry dates in one place so that I understand my status.

Success Criteria:

- Page shows current tier with tier badge display ("Tier 0", "Tier 1", "Tier 2" text labels).
- Page shows any fallback tier (for example, Tier 1 Lifetime acting as fallback under Tier 2 Annual).
- Page describes, at a high level, the benefits associated with the current tier.
- Page shows expiry date for Tier 1 or 2 Annual and clearly indicates renewal options, benefits of upgrading, with pricing.
- Page provides clear "Upgrade Now" or "Renew Now" buttons (if applicable, as Tier 1 Annual cannot be renewed) that initiate Stripe Checkout flow.
- Tier badges visible to logged-in members on: profiles, club rosters, event participant lists, search results, media author info.
- Tier badges NOT visible to anonymous visitors.

### M_Tier_Expiry_During_Active_Period

Access: Members with Tier 2 Annual whose tier expires during an active event registration period or vote.

Story: As a member whose Tier 1 or 2 Annual expires during a an active vote, event organization or other such case, I am notified of my tier expiry and/or my access to tier-dependent features. Tier expiry during a vote does NOT revoke eligibility.

Success Criteria:

- If member tier expires during an active event registration period where they have already registered, their registration remains valid for that event.
- Member receives email notification at Administrator-configurable offset(s) before tier expiry (defaults: 30 and 7 days) reminding them to renew to maintain access to tier-dependent features.
- Member receives a built-in day-of expiry notification (T+0; not separately administrator-configurable) confirming their tier has changed and explaining which features are now restricted.
- System audit logs all tier expiry events with member ID, old tier, new tier, and timestamp.
- The actual downgrade of Tier 2 Annual (including fallback to Tier 1 Lifetime) is performed automatically by the SYS_Check_Tier_Expiry system job; no manual admin action is required.
- For Tier 2 Annual members with Tier 1 Lifetime fallback: When Tier 2 Annual expires (tierExpiryDate = today), the SYS_Check_Tier_Expiry job atomically downgrades tierStatus to 'Tier 1_lifetime' and clears tierExpiryDate, ensuring there is no gap where the member has neither Tier 2 nor Tier 1 status. Member receives email notification explaining the fallback and confirming their Tier 1 Lifetime status remains active.
- Event Organizer continuity: If the member is serving as an Event Organizer for events in `published`, `registration_full`, `closed`, or `completed` status when their tier expires, they retain their Event Organizer role permissions for those specific events until each event reaches `completed` status. This prevents organizers from being locked out of managing active events mid-lifecycle. 

### M_Vouch_For_Tier1_Member

Access: Tier 2+ members can vouch for other members (competitors or non-competitors) to receive Tier 1 Annual status via two pathways:  

Pathway A (Direct Roster Access): Available automatically for a configurable duration (default: 14 days) after the Tier 2+ member (Event Organizer) uploads results for a sanctioned event they are organizing. During this window, the EO has direct UI access to vouch for any member (not limited to event participants).  

Pathway B (Request to Administrators): Available at any time outside direct roster access windows. Tier 2+ member submits a vouching request via the platform identifying the member and providing brief reason (e.g., "club member", "community volunteer"). Request is routed to Administrators who process it with offline consent from the Membership Director (external to platform). Administrators can approve or deny with audit logging.  

Story: As a Tier 2+ member, I can vouch for another member (including non-competitors such as club members or community volunteers) to receive Tier 1 Annual status so that they gain basic IFPA membership without paying, for a period not exceeding one year from the vouching date. Vouching is available either via direct roster access after uploading sanctioned event results, or via request to Administrators at any time.  

Success Criteria:  
Pathway A (Direct Roster Access after event results upload):

- When a Tier 2+ member Event Organizer uploads results for a sanctioned event via EO_Upload_Results, the system automatically grants direct roster access for a configurable duration (default: 14 days from results upload timestamp).
- During this access window, the UI displays a "Vouch for Tier 1 Members" tool with member search and vouching action.
- System validates that the authenticated member is an organizer (or co-organizer) for the sanctioned event whose results were just uploaded.
- Organizer can vouch for any member (not limited to event participants listed in uploaded results). This enables vouching for club members, volunteers, spectators, or other community members who supported the event.
- After the configurable window expires (default: 14 days), direct roster access is automatically revoked and UI no longer displays the vouching tool.
- Outside this window, the vouching UI is hidden and replaced with message: "Direct vouching access is available for 14 days after uploading results for your sanctioned events. To vouch for members at other times, submit a request to Administrators."

Pathway B (Request to Administrators outside windows):

- UI provides a "Request Tier 1 Vouching" form available to all Tier 2+ members at any time.
- Form fields: member to be vouched for, brief reason (required, max 200 chars: e.g., "club member", "community volunteer", "long-time supporter"), optional notes.
- On submit, system creates a Tier1VouchingRequest entity with status 'pending' and sends email notification to Administrator work queue.
- Request appears in A_Process_Tier1_Recognition_Requests Admin story work queue.
- On Admin approval (with offline MD consent): same tier logic as Pathway A is applied; requester and vouched member both receive email confirmation.
- On Admin denial: requester receives email with denial reason; vouched member is not notified.
- All requests, approvals, and denials are audit-logged with: requester ID, vouched member ID, reason, decision, timestamp.

Vouching logic (applies to both pathways):
- If vouched member is currently Tier 0, upgrade to Tier 1 Annual with tierExpiryDate = today + 365 days.
- If vouched member already has Tier 1 Annual with tierExpiryDate < today + 365 days, extend tierExpiryDate to today + 365 days.
- If vouched member already has Tier 1 Annual with tierExpiryDate >= today + 365 days (already at or beyond one year from today), no change; UI displays "No change needed — member already has Tier 1 Annual extending to or beyond one year from today" and prevents vouching action.
- If vouched member already has Tier 1 Lifetime or higher tier, the action is a no-op; UI displays "No change needed - member already has Tier 1 Lifetime or higher."
- Vouching cannot extend Tier 1 Annual beyond 365 days from the vouching date, regardless of pathway used.
- Repeated vouching within the same 365-day period does not stack beyond 365 days from the most recent vouching action.
- Vouching action is logged with: voucher member ID, vouched member ID, old tier/expiry, new tier/expiry, timestamp, reason/pathway ("direct_roster_after_event" or "admin_approved_request"), persisted in the database with a new row in the Entitlements Ledger table.
- Vouched member receives email notification: "You have been vouched for Tier 1 Annual by Voucher Name. Your Tier 1 Annual status is now active until expiry date. Brief explanation of Tier 1 benefits"
- Email notification clearly indicates whether vouching occurred via direct access (after event results upload) or via Administrator approval.

## 3.7 Voting

The following stories are for (non-admin) Members. More voting-related stories are given as Admin stories below (primarily A_Create_Vote).

### M_View_Vote_Options

Access: Different specific votes have different access rules (based on inclusion list, Tier status, HoF or BAP or Board flag). Therefore this workflow must mimic these access rules exactly. If the member can not vote for a given topic then they cannot see the options.

Story: As an eligible member, I can view the details of an active or upcoming vote (election or issue vote) so that I understand what is being decided and what my options are.

Success Criteria:

- Vote detail contains: title, description, eligibility rule summary, nomination window (optional), voting window, and background materials per option.
- Eligibility to vote is determined by the vote's configured rules (as defined in A_Create_Vote), not hard-coded in this story. For example, a HoF election is typically configured by the admin to restrict eligibility to members with the HoF flag, but this is a configuration choice, not a system constraint. Admins may configure any combination of tier, flag, or explicit inclusion list per A_Create_Vote.
- HoF elections also require that members be nominated during the nomination window, and that every candidate submits an affidavit to be included in the ballot, which will be included in the background materials.
- Page shows the list of choices (candidates or issue options) once the vote is open (or earlier if configured by admins).
- If the member is not eligible, then they will not see this option in the UI.
- Only eligible members can see voting details and submit a ballot.
- Member can submit exactly one ballot per vote.
- Ballot is stored in a way that preserves voter privacy and supports later tallying and cryptographic receipt verification. The server generates a random receipt token at submission time, emails the raw token to the member (and includes the SHA-256 hash in the email for reference), and stores only a SHA-256 hash of that token, never the raw token itself.
- Member receives a verification receipt by email after voting.
- Once a vote's status is 'published', vote results are visible to all members regardless of eligibility. The eligibility restriction applies only during the active voting period. This provides maximum transparency.

### M_Vote

Access: Different specific votes have different access rules (based on inclusion list, Tier status, HoF or BAP or Board flag).

Story: As an eligible member, I can cast an encrypted ballot in any active vote, so that my vote is recorded privately and counted in the final tally.

Success Criteria:

- Eligibility determined at vote opening time with a snapshot frozen for vote duration (UTC timestamps).
- After a ballot is accepted, the server generates a cryptographically random receipt token (UUID v4), emails the raw token to the member (and includes the SHA-256 hash in the email for reference), and stores only SHA-256(token) in the database. The raw token is never persisted. The member must retain this email to use receipt verification; the system cannot recover a lost token.
- Ballots are encrypted before storage and remain secret. Admins can only decrypt aggregated results via an automated process; nobody can see how an individual member voted. All decrypt operations are fully audit logged.
- Member sees a clear success message when vote is successfully recorded.
- Member sees a clear error message if voting fails, including a short explanation.

### M_Verify_Vote_And_View_Results

Access: Different specific votes have different access rules, and therefore this verification workflow must mimic these access rules exactly. If the member did not vote then they cannot verify that (non-existent) vote, but they can see the results if they were eligible.

Story: As a member who voted (or was eligible to vote) for a given topic, I can see the aggregated results. I can also verify that my ballot was included in the final tally using my verification receipt, so that the result is transparent and trustworthy.

Success Criteria:

- Voter submits the raw receipt token from their email to the verification page. The system computes SHA-256(submitted token) and checks it against the stored hash for that vote. A match confirms the ballot was recorded; no match (or no token) returns a generic "not found" response that does not reveal whether the token was wrong or was never issued.
- Vote privacy maintained through encryption.
- The system does not provide automated lost-token recovery; if a member loses their receipt token, verification cannot be completed unless the token is found.
- Verification does not reveal how the member voted, only that their ballot was included.
- Aggregated results will be viewable for every vote run on the site, with the authorization rule being simply that the viewer was eligible to cast a ballot.

### M_Nominate_HoF_Candidate

Access: Any member can nominate another eligible member to the Footbag Hall of Fame during the annual nomination window.

Story: Eligibility for the Footbag Hall of Fame is based on Year of First Involvement (YFI) in the sport. YFI includes competing as a Player or as a Contributor (organizing/producing tournaments, promotions, festivals and more). All nominees for the Footbag Hall of Fame must have a YFI that is 15 years or more from the year they are nominated.Nominations are focused on two banners: PLAYER: whose footbag history has displayed: Significance and Excellence in Competition, by winning and placing in the top 3 consistently at sanctioned IFPA Events. CONTRIBUTOR: whose footbag history has displayed: Significance and Excellence in Leadership Rolls, by producing and organizing tournaments, clubs, touring team activities, coaching and more.

The nomination process begins by selecting the member, and providing their full name and current contact information, also the nomination category (Player or Contributor), plus other freeform information in the Nomination Form.

Success Criteria:

- Nominating a member will create a Work Queue task for the Admin to approve, because the Admin must manually confirm the eligibility criteria have been met. Upon acceptance, this will send an email to the nominated member and also [director@footbaghalloffame.net](mailto:director@footbaghalloffame.net).
- The nominated member must then submit an affidavit before the nomination window closes, which is crucial background information, and is required to be eligible for the vote. The nomination and affidavit must be submitted during the Admin-configured nomination timeframe.
- Nominations are NOT carried forward to the next year automatically.
- Upon admin approval of a nomination, the system sets the `HoF_Nominated` flag on the nominated member. This flag indicates the member is an active HoF candidate for the current nomination cycle. 

### M_Submit_HoF_Affidavit

Access: A member who has been nominated to the Footbag Hall of Fame, and approved by an Admin as eligible, can submit an affidavit during the admin-configured nomination timeframe.

Story: As a member who has been nominated to the HoF, I can submit an affidavit in order to provide my footbag career background information, and to be eligible for the vote.

Success Criteria:

- The nominated member must submit an affidavit before the nomination window closes, which is crucial background information. The affidavit must be submitted during the Admin-configured nomination timeframe.
- Submitting the affidavit will make the member eligible for the vote, and the member will be included on the ballot along with the affidavit’s background information.

## 3.8 Media Sharing

All member-published media is public unless an Administrator removes it via moderation. There is no per-media member-controlled visibility toggle (for example public/private/unlisted). Members control their own content, and if they delete a photo, video link, or gallery, it is permanently gone.

### M_Upload_Photo

Access: Members (Tier 1+) can upload photos to personally named galleries.

Story: As a member, I can upload photos so that I share visual content.

Success Criteria:

- Upload photos via named gallery interface. For each member, the initial, default photo gallery name is Personal Gallery. Member can rename this, and/or create multiple named galleries to organize photos.
- JPEG and PNG only; GIF not supported. Animated content should be uploaded to YouTube or Vimeo and embedded via video links.
- Photo processing generates two variants only: Thumbnail (300×300 pixels) and Display (800px width maximum). Both stored as JPEG at 85% quality, sufficient quality for web viewing and sharing. Original uploaded file is discarded after processing,
- Add caption to photo optionally (plain text, max 500 chars).
- Tag optionally with hashtags for discovery (standardized tags for events and clubs, plus freeform tags such as tutorial, golf).
- Hashtag matching is case-insensitive for all tag operations (example: #Event_2025_beaver_open and #event_2025_Beaver_Open match identically).
- Hashtags stored with original capitalization for display quality (example: #Event_2026_Japan_Worlds displays as entered, not lowercased).
- Static tag suggestions are shown near the tag field using standardized event and club hashtags and popular community freeform tags. Clicking a suggested tag inserts it into the tag field; suggestions are not shown per keystroke as autocomplete (but can be added in phase two).
- Teaching moments displayed on My Content page empty state: show recent example photos with their hashtags and popular community tags, all clickable to insert into the tag field, and highlight aggregated hashtag statistics.
- Photo upload rate limited to 10 uploads per hour per member to prevent abuse.
- Photo upload controls are only rendered for Tier 1+ members.
- Visitors (not logged in) never see upload controls.
- See photo immediately after upload (synchronous processing).
- Photo tagged with event hashtag appears in that event's media gallery.
- Photo tagged with club hashtag appears in that club's media gallery.
- Upload completes during the request/response flow, so the user receives immediate success or failure feedback after upload/processing.
- On success, the UI receives sufficient data to display the uploaded photo and related metadata immediately.
- If upload/processing does not complete within the configured request timeout, the UI displays a clear error message and allows retry.

### M_Submit_Video

Access: Members (Tier 1+) can submit video links for inclusion in media galleries.

Story: As a member, I can submit YouTube or Vimeo video links so that I share video content.

Success Criteria:

- Accept URL patterns: youtube.com/watch?v=, youtu.be/, vimeo.com/
- System validates URL format and extracts video ID.
- Video metadata stored in video entity (uploaderId, platform, videoId, videoUrl, thumbnailUrl, caption, tags, status).
- Video thumbnails fetched from YouTube/Vimeo APIs for preview.
- No video file hosting on platform.
- Hashtag matching is case-insensitive for video tag operations (example: Tutorial and tutorial match identically).
- Video link submissions are rate-limited per member to prevent abuse (for example, up to 5 submissions per hour).
- Static tag suggestions are shown near the tag field using standardized event and club hashtags and popular community freeform tags. Clicking a suggested tag inserts it into the tag field; suggestions are not shown per keystroke as autocomplete (but can be added in phase two).
- Teaching moments displayed on My Content page empty state: show recent example photos with their hashtags and popular community tags, all clickable to insert into the tag field, and highlight aggregated hashtag statistics.
- Videos and photos can be mixed in named galleries.
- Video upload/link submission controls are only rendered for Tier 1 and Tier 2 members; Tier 0 members never see any video upload or submission controls.
- Visitors (not logged in) never see video upload or submission controls.

### M_Organize_Media_Galleries

Access: Members (Tier 1+) can organize their own media into named galleries and adjust gallery-level settings.

Story: As a member, I can organize photos and videos into named galleries with hashtags, captions, and optional external web page URLs.

Success Criteria:

- Photos and videos support same hashtag tagging system.
- Captions supported for both media types (max 500 chars, plain text).
- Can create named galleries mixing photos and videos.
- Each gallery can include optional external links that are validated before publication, with clear error messages and a simple retry path if validation fails.
- Media appears in personal galleries and event galleries via hashtag matching.
- Personal gallery retrieves media where uploaderId matches AND isAvatar equals false (excludes avatar photo).
- Club and Event galleries aggregate both content types by hashtag matching.
- Maximum 5 video embeds per named gallery to maintain performance.
- Gallery creation and rename controls are only rendered for Tier 1 and Tier 2 members; Tier 0 members never see gallery creation or rearrangement controls.

### M_Delete_Own_Media

Access: Members (Tier 1+) can delete media items they originally uploaded.

Story: As a member, I can delete my own photo, video link, or named gallery so that I control my content.

Success Criteria:

- Uploader can delete own media anytime, with immediate permanent effect (no soft delete for media).
- Delete controls for user-owned media are only rendered for Tier 1 and Tier 2 members; Tier 0 members never see delete controls because they cannot upload media.
- When deleting a media item, the deletion is permanent and has a cascading deletion of all the associated tags.

### M_Flag_Media

Access: Members (Tier 1+) can flag media they believe violates community guidelines. Visitors cannot flag content.

Story: As a member, I can flag photos or videos so that harmful/low-quality content is reviewed.

Success Criteria:

- Flagged items remain visible until an administrator reviews and decides; visibility never changes automatically.
- The system shall not alter visibility or ranking without explicit administrator action (no shadow banning).
- A work queue item is created and an email notification is sent to the admin-alerts mailing list per Global Behaviors rules (task type and entity ID only; no sensitive member data).
- Uploader can remove own media anytime without admin approval.
- Multiple flags from same user for same media not counted separately.
- Flagging is rate-limited to prevent abuse; limit is admin-configurable via `media_flag_rate_limit_per_hour` (default: 10 flags per member per hour).
- Flagging is available to membership tiers Tier 1+.

## 3.9 Email

### M_Manage_Email_Subscriptions

Access: Members can manage their mailing-list subscriptions.

Story: As a member, I can manage my mailing list subscriptions so that I control IFPA communications.

Success Criteria:

- Member profile includes a subscriptions list with categories: newsletter, board-announcements, event-notifications, technical-updates.
- Member can subscribe or unsubscribe via profile settings.
- System uses the subscriptions list to determine which bulk emails the member receives in each category.
- Changes made in the member's profile are respected by all future bulk emails for those categories.
- Event-specific communications may have separate, explicit opt-ins (for example, event reminders for registered participants).
- Unsubscribe is persistent: once unsubscribed from a category, the member does not receive emails in that category until they explicitly opt back in.
- Subscription changes logged to audit trail.

### M_Send_Announce_Email
Access: Tier 2+ members.

Story: As a Tier 2+ member, I can send an email to the IFPA announce mailing list so that I can create community announcements.

Success Criteria:  
- Email form includes: subject, message body, preview.  
- System sends to configured announce list address (default [announce@footbag.org](mailto:announce@footbag.org)).  
- Rate limiting to prevent abuse (admin-configurable).  
- All sends audit-logged (actor ID, subject, timestamp).

# 4. Event Organizer Stories

Event Organizers are members who create events. Organizers can invite up to 4 co-organizers who share identical event management permissions. Members can organize multiple events simultaneously. Organizer permissions are event-scoped, meaning that being an organizer (or co-organizer) for one event grants permissions only for that event. Any EO can send bulk emails to registered participants, upload results, and the other functionality specified below.

Tier 1 can create basic/local events; Tier 2 active required for sanctioned and paid events.

## 4.1 Event Lifecycle

### Event Status Lifecycle

Valid event statuses and their transitions:

- `draft` — initial state on creation.
- `pending_approval` — paid or sanctioned event submitted for admin review (from `draft`).
- `published` — visible and open for registration. Free events transition `draft → published` on creation. Paid/sanctioned events transition `pending_approval → published` on admin approval.
- `registration_full` — capacity limit reached; no new registrations accepted (from `published`).
- `closed` — registration deadline passed or organiser manually closed registration (from `published` or `registration_full`).
- `completed` — event has concluded and results may be posted (from `closed`). The `completed` state is terminal. Events with published results cannot be canceled, deleted, or transitioned to any other status.
- `canceled` — event canceled at any point before `completed`; registrants are notified.  The `canceled` state is terminal; canceled events cannot be re-opened or completed.

No other status values are valid. All queries and conditional logic must use only these canonical strings.

### M_Create_Event

Access: Members (Tier 1+) can create events. This is how a member becomes an Event Organizer.

Story: As a member, I can create an event with all necessary details and optionally configure payment, so that I can become an Event Organizer, and host tournaments and gatherings.

Success Criteria:

- Tier 1 members can create basic free events; Tier 2 active members can request sanctioned events and enable paid registration.

Event creation form includes: title, description, start date, end date, location (city, state or province (optional), country), registration deadline, capacity limit (optional), competitor registration fee (optional, requires Tier 2 active and admin approval to set up), participant (spectator) fee (optional), t-shirt size (optional). Organizer defines a flexible list of event disciplines (freeform names such as shred-30 or ruler-of-the-court). For each discipline, organizer specifies whether it requires single/doubles/mixed doubles designation, and category (net, freestyle, golf, sideline). Sideline includes formats such as 2-square, 4-square, consecutive variants, one-pass, and social.

- Tier 1 members can create basic/local events without fees.
- Tier 2 active members can request sanctioned events and configure paid registration (subject to admin approval). Payment configuration (if enabled): competitor registration fee, (optional) spectator fee.
- Sanction request sends notification to admins for review, and such events are only published upon approval.
- Organizer sees a clear success message when event is created.
- Organizer sees clear error messages for validation failures with hints about what to fix.
- Member gains Event Organizer status for this event (only).
- An Event Organizer may organize more than one event at a time.
- For free events, event status changes to published, Email sent to all event organizers to confirm. News item is created. Event will appear in Upcoming Events list. For paid events, these actions must wait for Admin approval.

As an event organizer with active Tier 2, I can select the sanctioned option for my event so that it gains credibility and access to paid features (upon admin approval).

- Only Tier 2 active organizers can request sanction.
- Sanction request form includes: fee justification.
- Organizer receives email confirmation that request is pending.
- Sanction status visible on event detail page: pending, approved, rejected.
- Approved sanction enables: paid registration.
- Rejected sanction includes admin reason for rejection.
- All sanction requests audit-logged.
- Selecting the sanctioned event option creates email to all Admins for review, and appears in the Admin work-to-do queue.

### EO_Edit_Event

Access: Event organizers can edit events they are assigned to, within the constraints for free vs sanctioned events.

Story: As an event organizer, I can edit event details so that I can update information or correct errors.

Success Criteria:

- All fields may be edited except free/sanctioned status.
- Co-organizers can edit all event fields.
- All edits audit-logged with organizer ID, fields changed, old values, new values, timestamp.
- Organizers see a clear success message when event is updated.
- Organizer sees clear error messages for validation failures.

### EO_Delete_Event

Access: Event organizers can delete their own events only when allowed by status (for example, drafts without registrations), following the event-lifecycle rules.

Story: As an event organizer, I can delete my event so that I can remove canceled or duplicate events.

Success Criteria:

- Cannot delete event with confirmed registrations (must close registration and contact participants first).
- Deletion is permanent (hard delete). The event record is immediately removed from the database, except that events with published results are never deleted, as they are preserved permanently for historical record.
- Deleted events are hidden from public listings immediately upon deletion.
- All participants notified via email of event deletion.
- Deletion audit-logged with organizer ID, reason, timestamp.
- Organizer sees confirmation dialog before deletion: "Delete Event Name? This will cancel the event and notify all X registered participants."

### EO_Manage_CoOrganizers

Access: Any organizer of an event can manage co-organizers for that event.

Story: As an event organizer, I can add, view, and remove co-organizers so that I manage my event team. An event organizer cannot remove oneself if the only organizer, but first must promote someone else.

Success Criteria:

- An organizer can add up to 4 co-organizers by member id.
- System sends email to new organizer with key points: event name, event date, co-organizer responsibilities.
- Co-organizer gains identical event management permissions as original organizer.
- Maximum 5 total organizers per event.
- Organizer can view list of all current co-organizers. List shows: co-organizer name, member id, date added.
- Co-organizer can opt out of leadership role via the member dashboard.
- All co-organizer actions are audit-logged.
- Organizers see a clear success message when co-organizer is added or removed.
- Organizers array displayed on event detail page showing all current organizers (names only on public page); contact info visible to authenticated members only.
- The user interface hides remove-self functionality (button or link) when the current authenticated user is the sole organizer of the event.

## 4.2 Registration Management

### EO_View_Participants

Access: Event organizers can view full participant lists for their events.

Story: As an event organizer, I can view the list of registered participants so that I can plan the event.

Success Criteria:

- Participant list shows: member name, registration date, tier status, city, country, email (if opted in).
- List sortable by registration date or name.
- Total participant count displayed.
- Payment status visible if event has fees.
- Participant list and exports include registration type (Competitor/Attendee-Supporter), selected categories (if competitor), and partner/team fields (if applicable).

Impact: For sanctioned events (sanction status = approved), the participant list supports marking confirmed participants as "Attended" after the event ends. Organizers can mark individual participants or use bulk-select to mark multiple participants at once. All attendance marks and any resulting tier changes are audit-logged with: actor member ID, affected member ID, event ID, old tier/expiry, new tier/expiry, timestamp, reason "sanctioned_event_attendance".

When a participant is marked Attended for a sanctioned event:

- If the member's current tier is Tier 0, upgrade to Tier 1 Annual with expiry = event startDate + 365 days.

- If the member already has Tier 1 Annual with expiry  event startDate + 365 days, extend expiry to event startDate + 365 days.

- If the member already has Tier 1 Annual with expiry = event startDate + 365 days, no change (do not shorten existing expiry).

- If the member has Tier 1 Lifetime or higher tier, no change (no-op).

### EO_Close_Registration

Access: Event organizers can close registration for their events according to the registration rules.

Story: As an event organizer, I can close event registration so that I can stop accepting new participants.

Success Criteria:

- Organizer can close registration at any time.
- Closed registration prevents new signups.
- Event page displays "Registration Closed" status.
- All registration status changes audit-logged.

### EO_Export_Participants

Access: Event organizers can export participant lists for their events as CSV.

Story: As an event organizer, I can export the participant list so that I can use it for external tools and planning.

Success Criteria:

- Export generates CSV file with: member name, email (if opted in), city, country, registration date, tier status, payment status.
- Export includes only confirmed participants (not pending or rejected).
- Export filename: eventname_participants_YYYYMMDD.csv
- Participant list and exports include registration type (Competitor/Attendee-Supporter), selected categories (if competitor), and partner/team fields (if applicable).

## 4.3 Communication

### EO_Email_Participants

Access: Event organizers can send an email to participants of their events.

Story: As an event organizer, I can send an email to all registered participants so that I can communicate important event information.

Success Criteria:

- Email form includes: subject, message body, preview.
- Email sent to all confirmed participants (not pending or rejected).
- Emails sent via SES with proper headers and unsubscribe links.
- Send rate limited to prevent abuse: maximum 1 email per event per day.
- All bulk emails audit-logged with organizer ID, event ID, recipient count, subject, timestamp.
- Organizer sees confirmation: "Email sent to X participants."
- Recipients are event registrants (competitors and attendee/supporters).
- Email body is plain text (no HTML).
- System stores an archive record of each sent event email (subject, body, sender, timestamp, recipient count) visible to the organizer for that event and to admins globally.

## 4.4 Results Publishing

### EO_Upload_Results

Access: Event organizers can upload results for events they organize, including sanctioned events where results feed into rankings.

Story: As an event organizer, I can upload event results so that participants and the community can view outcomes.

Success Criteria:

- Results upload accepts CSV with enough information to create `event_results_uploads`, `event_result_entries`, and `event_result_entry_participants` database rows for singles and multi-participant placements (if that data is available for the event).
- Results visible on event detail page after upload.
- Results displayed as sortable table.
- Results also added to participant profiles (if participant linked to member account).
- Results publication generates news feed item.
- Only organizers can upload results.
- Results upload audit-logged.
- Results can be uploaded for any event (sanctioned status does not affect results posting).
- Each results upload resets the direct roster access window (for vouching) to `vouch_window_days` days from the most recent upload timestamp. Only the most recent upload timestamp is used for vouching window calculation. Admins can view the roster access window status and expiry date per event in the admin dashboard.

Impact:

For sanctioned events, uploading results triggers a two-step attendance confirmation process: Step 1: Automatic attendance for winners: Any member accounts appearing in the uploaded results are automatically marked as "Attended" and receive Tier 1 Annual extension automatically. Step 2: Attendance confirmation for non-placing participants: After results upload completes, the system displays an attendance confirmation screen showing all registered participants (confirmed registrations) who do NOT appear in the uploaded results with checkboxes. The goal is to verify attendance, which triggers automatic Tier 1 Annual status and/or adjust the expiry date to be exactly one year from the tournament date. All attendance confirmations (both automatic for winners and manual for non-placing participants) and resulting tier changes are audit-logged with: organizer member ID, affected member ID, event ID, old tier/expiry, new tier/expiry, timestamp, reason "sanctioned_event_attendance". Members who receive tier upgrades or extensions are sent a notification email explaining they received Tier 1 Annual (or extension) for participating in Event Name, including new expiry date and brief explanation of Tier 1 benefits.

Roster Access Trigger (for sanctioned events only): Upon successful results upload for a sanctioned event, the system automatically grants the organizer (and all co-organizers) direct roster access for a configurable duration (default: 14 days after results upload, parameter key: vouch_window_days). This roster access enables the event organizer to use the M_Vouch_For_Tier1_Member workflow (Pathway A: Direct Roster Access) to vouch for any member, including event participants, club members, volunteers, and community supporters. The roster access window is tracked per organizer-event pair and automatically expires after the configured duration. System sends email notification to organizer(s) when roster access is granted: "Results uploaded for Event Name. You now have direct roster access to vouch for Tier 1 members for the next 14 days."

# 5. Club Leader Stories

Club Leaders are members who create clubs. Leader can add up to 4 co-leaders who share club information editing permissions.

## 5.1 Club Lifecycle

Club operability rule: A club is considered non-operable if it has no current leader and/or no club contact email. Non-operable clubs are flagged into the admin work queue for remediation. Admin remediation options include assigning/reassigning a leader, obtaining/updating a contact email, or archiving the club if it is defunct or unresolved.  

### M_Create_Club

Access: Members (Tier 1+) who are not already a Club Leader can create a new club.

Story: As an eligible member, I can create a club so that I can become a Club Leader, and organize a local footbag community.

Success Criteria:

- Club creation form includes: club name, description, city, country, contact email (required for all new clubs). A club with no contact email is treated as non-operable and flagged for admin remediation.

- Standardized hashtag follows pattern club_{location_slug}.
- Only Tier 1 or Tier 2 members can create clubs.
- Leader sees a clear success message when club is created.
- Leader sees clear error messages for validation failures.
- Member gains Club Leader status for this club. A member may lead only one club at a time.
- If the authenticated member already holds the Club Leader role for any active club, the create club option is not shown in the UI. If attempted via direct URL or API, the service returns a validation error: "You are already a Club Leader for [Club Name]. You must relinquish leadership before creating a new club."
- Club display names are not required to be globally unique (for example the name could be "Hacky Crew"). Two clubs may share the same display name. The standardised club hashtag (derived from the club name at creation and globally unique) is the canonical identifier. The UI makes the club hashtag visible at creation so leaders understand it is the persistent unique handle.

### CL_Edit_Club

Access: Club leaders can edit their club's information and settings.

Story: As a club leader, I can edit club information so that I can keep club details current.

Success Criteria:

- Co-leaders can edit all club information.
- All edits audit-logged with leader ID, fields changed, old values, new values, timestamp.
- Leaders see a clear success message when club is updated. If a club edit results in a blank contact email, the system warns the leader that the club will be flagged for admin follow-up, and if approved anyway, creates or updates a “Club Needs Contact” admin work queue item.

### CL_Mark_Club_Inactive

Access: The club leader can mark the club inactive or reactivate it later.

Story: As a club leader, I can mark my club as inactive so that it's hidden from active listings but preserved for history.

Success Criteria:

- Inactive clubs hidden from public club directory.
- Inactive clubs still accessible via direct link.
- Club members retain their clubId affiliation but see warning that club is inactive.
- Club leader can reactivate club at any time.
- Inactive status change audit-logged.

### CL_Archive_Club

Access: The club leader can archive the club if it is inactive.

Story: As a club leader, I can delete my club from the active clubs so that I can remove defunct clubs.

Success Criteria:

- Cannot delete club with active members (must remove all members first or mark inactive).
- Club deletion sets the club's status to 'archived'. Club records are never permanently deleted and do not use the soft-delete (deleted_at) pattern. Archived clubs remain in the database and are excluded from public listings, but are preserved for historical reference and referential integrity.
- Deleted clubs hidden from all listings immediately.
- Club members' clubId set to null upon deletion.
- Deletion audit-logged with leader ID, reason, timestamp.
- Leader sees confirmation dialog before deletion.

## 5.2 Leadership Management

### CL_Manage_CoLeaders

Access: The club leader can add, view, and remove co-leaders for the club.

Story: As a club leader, I can add, view, and remove co-leaders so that I manage my club leadership team. A club leader cannot remove oneself if the only leader, but first must promote someone else.

Success Criteria:

- Any leader can add up to 4 co-leaders by member id.
- System sends email to new leader with key points: club name, responsibilities.
- Upon acceptance, co-leader gains club information editing permissions.
- Maximum 5 total leaders per club.
- Any leader can view list of all current co-leaders.
- List shows: co-leader name, date added. Email visible to fellow leaders (role-scoped) only.
- Co-leader can opt out of leadership role via the member dashboard.
- All leader actions are audit-logged.
- Leader sees a clear success message when co-leader is added or removed.
- Leaders array displayed on club detail page showing all current leaders (names only on public page); contact info visible to authenticated members only.
- The user interface hides remove-self functionality (button or link) when the current authenticated user is the sole leader of the club.
- After any leadership change, the system re-evaluates club operability. If the club has zero leaders, the system creates or updates a “Club Needs Leader” admin work queue item. If the club has no contact email, the system creates or updates a “Club Needs Contact” admin work queue item.

# 6. Administrator Stories

Administrators are member volunteers with elevated privileges for platform operations, content moderation, and system configuration. Administrators are assigned manually and must be IFPA members with Tier 2 Lifetime or Tier 3 status. All admin actions that modify data are audit-logged with admin ID, action type, reason, and timestamp. There is no UI for becoming an Admin, as this is done usually by another Admin, but could be done also by a System Administrator (a developer role not a user role) in order to grant system privileges.

## 6.1 Event and Payments

### A_Approve_Sanctioned_Event

Access: Only admins can review and approve Stripe configuration for paid events. In this system, paid registration is only enabled after an event's sanction request is approved; sanction status and payment enablement are linked by policy.

Story: As an admin, I can approve or reject an event's payment configuration so that paid events are controlled.

Success Criteria:

- Review event details and fee structure in approval queue.
- Approve or reject with reason.
- On approval: event status changes to published, payment configuration enabled, Email sent to all event organizers to confirm. News item is created. Event will appear in Upcoming Events list.
- On rejection: event status remains draft, Outbox sends organizer notification with reason.
- Payment approval is event-specific configuration, not persistent eventOrganizer permission (which is separate).
- All approval actions logged.
- Admin reviews pending sanction requests in queue (scan events where status === 'pending_approval').
- Admin can see: event details, organizer history, fee amount, organizer tier status.
- Approval simultaneously: marks event as sanctioned AND enables paid registration.
- All approval/rejection decisions audit-logged with admin ID, decision, reason, timestamp.
- Admin cannot approve sanction if organizer lacks active Tier 2 status.
- Admin sees a clear success message when approval/rejection completes successfully.
- Admin sees a clear error message when action fails, including a short explanation.
- The actual payment of funds to the Event Organizer’s bank account happens outside of this system by the IFPA Treasurer.

### A_Reconcile_Payments

Access: Only admins can run or review payment reconciliation and view the complete list of inbound payments.

Story: As an administrator, I can view all inbound payments (donations, membership fees, and event registrations) and see a separate list of reconciliation issues, so that I can confirm our records match Stripe, investigate discrepancies, and, when needed, see donation comments in context.

Success Criteria:

- There is an admin-only All Payments view that lists all inbound payments recorded by the system, including donations, membership purchases/upgrades, and event registration fees.
- The All Payments view allows filtering and sorting by type, date range, status, member, event, and payment reference, and shows at least: type, date, amount, currency, status, related member ID, related event/club where applicable, and Stripe payment reference.
- For donation payments, the admin can see the member’s donation comment as a read-only field when viewing payment details, so that reconciliation and investigations can take the comment into account without allowing admins to edit it.
- A nightly worker (or equivalent scheduled job) performs reconciliation against Stripe (or the payment provider) and records mismatches (for example missing webhooks, amount discrepancies, status mismatches, or unexpected duplicates).
- The Reconciliation Issues view includes a status filter with options: Outstanding (default) / Resolved / All. Resolved reconciliation issues show: admin who resolved the issue, resolution timestamp, resolution note explaining action taken. This allows multiple administrators to see what reconciliation issues have already been handled and by whom.
- A periodic summary is sent to admins at the configured cadence (default: every 7 days, keyed by `reconciliation_summary_interval_days`) with a digest of outstanding or recently resolved reconciliation issues.

## 6.2 Data Management

### A_Override_Member_Data

Access: Only admins can override member data in exceptional cases where manual correction is required, for example, to fix a data bug, clean up if a member dies, or delete a bogus registration.

Story: As an Admin, I can manually override member data in exceptional cases so that I resolve issues, grant access, correct errors, or anything else allowed by the system.

Admin can delete member accounts that violate registration rules (real full name, correct location) upon discovery. This is designed for exceptional cases where a member account was created with invalid data (fake name, bogus location) that was not caught by initial validation. Member receives notification email that account was deleted for policy violation."

Success Criteria:

- Admin can access member profile from admin member management interface.
- Admin can change tierStatus to any valid state: `tier0`, `tier1_annual`, `tier1_lifetime`, `tier2_annual`, `tier2_lifetime`, `tier3` (using canonical database string values).
- For annual memberships, admin can set or modify tierExpiryDate.
- Admin should not edit member-editable fields (email, display name, city, country, club affiliation) via this interface; members must edit these themselves, except in the case of a member death.
- Event results and other data fields that could be buggy can also be edited via this interface, but will require additional UI support.
- Mandatory reason field for manual adjustment (typically: payment issue resolution, complimentary access, error correction).
- Confirmation dialog before applying with member name, old tier, new tier, and reason.
- Member receives email notification of tier change with key points: new tier, expiry (if applicable), reason.
- All manual data overrides audit-logged with admin ID, member ID, old values, new values, reason, timestamp.
- Admin sees a clear success message when adjustment completes successfully.
- Admin sees a clear error message when adjustment fails, including a short explanation.

### A_Grant_HoF_BAP_Board_Status

Access: Only admins can grant Hall of Fame (HoF), Big Add Posse (BAP), and IFPA Board status to eligible members.

Story: As an admin, I can grant special status badges to a member if they qualify.

Success Criteria:

- Admin can select member and grant Hall of Fame (HoF) or Big Add Posse (BAP) status flags (assuming they qualify per IFPA criteria). HoF and BAP badges are permanent lifetime honors that persist indefinitely. The act of assigning these badges automatically changes the membership tier (and fallback tier) to Tier 2 Lifetime, unless the member is a Board Member (Tier 3), in which case only the fallback tier is modified. Granting these badges sends a congratulatory email to the member.
- The IFPA Board flag is temporary and applies only while the member is an active board member. When the IFPA Board flag is set active, the system automatically sets the member's tierStatus to Tier 3 (IFPA director). When the IFPA Board flag is removed (member no longer on board), tierStatus reverts to the member's previous tier (typically Tier 2 or Tier 1, depending on their paid membership status). All Board flag changes and resulting tier changes are audit-logged.
- Badges are visible on member profile and anywhere member tier is displayed.
- The IFPA Board flag is temporary, as long as the member is an active board member only.
- All status grants audit-logged with admin ID, member ID, reason, timestamp.

### A_View_Member_History

Access: Only admins can review member history data.

Story: As an admin, I can view a member's complete tier and special flag change history so that I can investigate discrepancies or disputes.

Success Criteria:

- Admin can view audit log for specific member showing all tier changes, HoF grants, BAP grants, manual overrides.
- History displays: timestamp, action type, old values, new values, admin who performed action, reason.
- History sortable by timestamp (newest first by default).
- History includes system-initiated changes (automatic Tier 2 expiry, payment-triggered upgrades).

### A_View_Official_Roster_Reports

Access: Only admins can view official IFPA roster reports and exports.  

Story: As an admin, I can view the official IFPA roster count and membership breakdowns so that I can report accurate membership statistics to the IFPA Board and external stakeholders, excluding Tier 0 non-voting members per official IFPA rules.  

Success Criteria:  
- Admin dashboard includes an "Official Roster" section displaying: Total official IFPA members (count of members where tierStatus in 'Tier 1_annual', 'Tier 1_lifetime', 'Tier 2_annual', 'Tier 2_lifetime', 'Tier 3'). Breakdown by tier: Tier 1 Annual count, Tier 1 Lifetime count, Tier 2 Annual count, Tier 2 Lifetime count, Tier 3 count. Breakdown by special flags: HoF count, BAP count, Board Member count (these may overlap with tier counts). Total registered accounts (including Tier 0) for comparison, with clear label: "Total Registered Accounts (including Tier 0 non-voting)". Counts update via SQL query on demand.

- Admin can export official roster as CSV with columns: member ID, display name, tier status, tier expiry date (if applicable), special flags (HoF/BAP/Board), email (opt-in only), city, country.  
- Export filename: official_roster_YYYYMMDD.csv  
- Export explicitly excludes Tier 0 members per IFPA rules.  
- Export includes a header comment line: "# Official IFPA Roster - Tier 1+ members only - Generated YYYY-MM-DD by admin name"  
- All roster report views and exports are audit-logged with admin ID, export type, member count, timestamp.

### A_Process_Tier1_Recognition_Requests

Access: Only Admins can review and approve/deny Tier 1 vouching requests submitted by Tier 2+ members outside direct roster access windows.  

Story: As an Administrator, I can review pending Tier 1 vouching requests submitted by Tier 2+ members, and approve or deny each request with a reason, acting with offline consent from the Membership Director (external to platform), so that roster updates outside direct-access windows are controlled while preventing frivolous or abusive requests.  

Success Criteria:  
- Admin sees a work queue showing all pending Tier1VouchingRequest entities where status = 'pending'.  
- Each request displays: requester name and member ID, target member name and member ID, reason provided by requester, request submission timestamp, target member's current tier status.  
- Admin can take two actions per request: Approve: Applies the same Tier 1 Annual vouching logic as direct roster access (extend to today + 365 days or upgrade from Tier 0), sends confirmation emails to requester and vouched member, sets request status = 'approved', audit-logs with approval reason (optional, defaults to "approved by Admin with MD consent"). Deny: Sets request status = 'denied', sends email to requester with denial reason (mandatory text field, max 500 chars), does not notify target member, audit-logs with denial reason.  
- Admin approval/denial actions presume offline consultation with or consent from the Membership Director (external workflow, not tracked in platform). Platform does not enforce or verify MD consent; it is the Admin's responsibility to obtain appropriate authorization before acting.  
- Approved and denied requests remain in the system permanently for audit purposes and are viewable in a separate "Processed Requests" view.
- All approve/deny actions are persisted as a new row in the tier_grants_base table (which tracks all tier-related grants and associated qualifying actions, such as vouching from a Tier 2+ member, or by other actions such as a purchase).  
- This Admin workflow represents the platform implementation of IFPA rules requiring "Membership Director discretion"; the actual Membership Director authority remains external to the platform.

### A_Reassign_Club_Leader

Access: Only admins can reassign club leadership and remediate non-operable clubs.  

Story: As an Administrator, I can reassign club leadership and resolve club operability issues so that clubs remain operable when leadership or contactability breaks down.  

Success Criteria:

- Admin can assign a club leader from the member base (audit-logged).
- Clubs with zero leaders are flagged "Needs Leader" and appear in an admin work queue.
- Clubs with no contact email are flagged “Needs Contact” and appear in an admin work queue.  
- Admin can resolve a “Needs Leader” item by assigning/reassigning a leader, or by archiving the club if defunct.  
- Admin can resolve a “Needs Contact” item by updating the club contact email, or by archiving the club if defunct.  
- Reassignment restores normal club management capabilities when a leadership gap was the blocking issue.

### A_Reassign_Event_Organizer

Access: Only admins can reassign event leadership.

Story: As an Administrator, I can reassign event leadership so that events remain operable if an event organizer leaves or deletes their account, leaving no more organizers.

Success Criteria:

- Admin can assign an event organizer from the member base (audit-logged).
- Events with zero organizers are flagged "Needs Organizer" and appear in an admin work queue.
- Reassignment restores normal event management capabilities.

### A_Fix_Event_Results

Access: Only admins can correct official event results and related event records.

Story: As an administrator, I can correct event results and other official event records when organizers make mistakes, so that historical records remain accurate while all corrections are fully auditable.

Success Criteria:

- Admins can open a specific event and view its official results (for example divisions, placements, scores, and medalists) and other key event metadata that are treated as official records.
- Admins can make limited corrections to official event results and metadata (for example fixing a misspelled competitor name, wrong placement, or swapped divisions) without editing free-form content such as news posts or arbitrary descriptions.
- Every correction requires a mandatory “reason for correction” note entered by the admin.
- Each correction is recorded in an audit log that includes before/after values, admin identity, timestamp, and the reason for correction.
- Participants and organizers see the corrected results in all normal views; where appropriate.
- Corrections do not bypass normal publishing or sanctioning rules: only events that are otherwise valid (for example sanctioned where required) can have their official results corrected.

### A_Mark_Member_Deceased

Access: Only admins can mark members as deceased.

Story: As an administrator, I can mark a member as deceased so that their account is handled appropriately while preserving their historical contributions and honoring their privacy.

Success Criteria:

- Admin can select a member and mark them as deceased via a dedicated action.
- System adds a deceased: true flag and deceasedAt timestamp to the member record.
- Deceased member accounts are immediately removed from active member search results, removed from club rosters, and unregistered from any upcoming events.
- If member has HoF or BAP status, these honors remain visible with the member's name and brief bio to preserve community history.
- Member's uploaded media (photos/videos) remains published with attribution preserved to honor their contributions.
- Member's historical event results, club affiliations, and other community contributions remain visible in archives and historical records.
- Login is disabled for deceased member accounts (cannot authenticate).
- Email address and other private contact information are permanently removed after a admin-configurable grace period (in case of error).
- Admin action requires mandatory reason field (typically: "Member deceased" or similar).
- Confirmation dialog required.
- All marking actions audit-logged with admin ID, member ID, reason, timestamp.
- Admin sees a clear success message when action completes.
- If marking was done in error, admin can remove the deceased flag within a configurable grace period with audit logging; after grace period, only full account deletion is available.

### A_Manual_Legacy_Claim_Recovery

Access: Admins only.

Story: As an admin, I can help a member recover or complete legacy account linkage when self-serve claim is unavailable.

Success Criteria:

- Admin can locate imported legacy member rows by legacy email address, legacy username, or legacy member ID.
- Admin can see why self-serve claim is unavailable for a given row (no usable email, row flagged for review, etc.).
- Admin can update the legacy email address on an imported row to a reachable mailbox, enabling a re-attempt of self-serve claim.
- Before performing a manual merge, admin must enter a non-empty reason and verification note.
- Manual merge follows the same field-level merge rules as self-serve claim.
- Manual merge is audit-logged with actor, target imported row, active account, reason, verification note, and timestamp.
- Manual merge never auto-promotes `legacy_is_admin` metadata to a live admin role.

### A_Resolve_Bootstrap_Club_Leadership

Access: Admins only.

Story: As an admin, I can resolve provisional legacy club leadership when mirror-derived bootstrap data could not be automatically finalized.

Success Criteria:

- Admin can view bootstrapped clubs with unresolved or conflicting provisional leaders.
- Admin can promote a provisional leader by linking them to a correctly claimed member's live account.
- Admin can supersede the provisional assignment and appoint a live leader through the standard club leadership workflow, marking the bootstrap row superseded.
- Admin can reject a provisional assignment as incorrect, marking the bootstrap row rejected.
- All resolution actions are audit-logged with actor, club, bootstrap row, action taken, and timestamp.

## 6.3 Content Moderation

### A_Moderate_Media

Access: Only admins can review and act on flagged media, including deleting items.

Story: As an admin, I can review flagged media and Delete or take No Action with reason so

that I resolve cases.

Success Criteria:

- Admins see Takedown Queue (typically 0 to 10 items).
- Display flag reasons and sample thumbnails.
- Visibility into flagging patterns: who flagged what, when, and any relevant aggregate patterns (for example: repeated flagging by the same accounts), without storing IP-derived data.
- Admin decision buttons: Delete hides immediately and removes origin access immediately; cached CDN copies may persist briefly per TTL/invalidation.
- All actions append to immutable audit log with actor, reason, and affected mediaId.
- System emails uploader with decision.
- Administrators can set or unset any flags to maintain consistency; all changes audit-logged.

### A_Create_News_Item

Access: Only admins can manually create a news item.

Story: As an admin, I can manually author a news item so that I can publish announcements not auto-generated by system events.

Success Criteria:

- Admin can create a news item with: title (required, max 200 chars), body text (required, Markdown-safe), optional linked entity reference (event ID, club ID, vote ID, or none), and publish date (defaults to now).
- Created news item is immediately visible in the news feed (or at the specified publish date if future-dated).
- Creation is audit-logged with admin ID, timestamp, and news item ID.
- Manually created news items can be edited or deleted via A_Moderate_News_Item.

### A_Moderate_News_Item

Access: Only admins can edit, or remove news feed items.

Story: As an admin, I can review and moderate auto-generated news feed items so that I ensure content quality.

Success Criteria:

- Admin can edit, or reject news items.
- Rejected items are hidden from news feed.
- Edited items will reflect updated text in news feed.
- Admin can delete a NewsItem permanently (hard delete). Deletion is immediate and irreversible.
- Delete action requires a reason (mandatory text field, max 500 chars).
- Confirmation dialog before deletion, clearly stating the action is permanent.
- On delete: NewsItem is immediately and permanently removed from the database and hidden from the public feed. The deletion is recorded in the audit log with admin ID, news item ID, reason, and timestamp.
- All actions audit-logged.

### A_Archive_Club

Access: Only admins can archive or mark clubs defunct beyond what club leaders can do.

Story: As an admin, I can mark a club defunct/archived and notify members so that directories stay accurate. Archiving may be used to resolve non-operable club cases (for example, unresolved “Needs Leader” and/or “Needs Contact” queue items) after remediation attempts fail or the club is confirmed defunct.

Success Criteria:

- Sets status: "archived" in club data.
- All current club members' clubId is set to null (they become unaffiliated). Affected members receive an email notification explaining the club was archived and their membership has ended.
- Preserves club data for 7 years per retention policy.
- Records an audit log entry.

## 6.4 Vote Management

**Vote Status Lifecycle**

All votes have a status field constrained to the following valid values. No other status values are valid.

- `draft` — Vote created but not yet open. Valid transitions: → `open` (automatically when open_datetime is reached), → `canceled` (A_Cancel_Vote).
- `open` — Active voting period; eligible members can submit ballots. Valid transitions: → `closed` (automatically via SYS_Close_Vote when close_datetime is reached), → `canceled` (A_Cancel_Vote).
- `closed` — Voting period ended; awaiting tally. Valid transitions: → `published` (A_Publish_Vote_Results), → `canceled` (A_Cancel_Vote).
- `published` — Results published and visible to all eligible members. Terminal state; cannot be canceled or reversed.
- `canceled` — Vote voided before results were published. Terminal state.

### A_Create_Vote

Access: Only admins can configure and create voting topics.

Story: As an Administrator, I can create a vote (election or issue vote) so that eligible members can participate securely within a defined window.

Success Criteria:

- Admin defines: title, description, vote type (Election / Issue), nomination window (optional), voting window, ballot type (single-choice / multi-choice), and background materials (text + links/attachments).
- Admin defines eligibility rules using member attributes and flags (Tier status, HoF, BAP, Board flags) or an explicit inclusion list.
- System validates: date ordering, required fields, and that eligibility rules are internally consistent.
- System generates a unique vote ID and audit-log record of creation.
- For HoF elections, any member can submit nominations during the nomination window, but to be included in the ballot, the nominated candidates must provide an affidavit that explains their qualifications, basically their footbag career achievements. This information will be included as part of the vote’s background materials.
- Eligibility for candidates/options is enforced by the vote’s configured rules.
- At ballot open, the set of options is locked.
- Eligibility Changes: Members cannot gain or lose eligibility after vote opens, ensuring fairness.
- Eligibility is evaluated and snapshotted at the moment the vote transitions to `open` status. Eligible members at vote-open time are written as rows into `vote_eligibility_snapshot_base`. Members retain voting rights for the full voting window even if their tier or flags change while the vote is open.

### A_Publish_Vote_Results

Access: Only admins can publish vote results.

Story: As an Administrator, I can publish the results of a vote so that members can see outcomes.

Success Criteria:

- All decryptions logged to audit trail.
- Publish tally with transparent vote counts visible to all members**.**
- System provides tallies according to the configured ballot type.
- Admin can publish results and optionally include a short written summary.
- Publish creates a news item linking to the vote results page.
- System provides vote receipts/verification support as described in member voting stories.
- Publishing results does NOT automatically change member roles/flags (e.g., boardMember). Admins apply outcomes manually outside the vote system.
- Tallying is permitted only when vote.status equals 'closed' AND current server timestamp exceeds vote.close_datetime. The system enforces both conditions to prevent early result access.
- Audit records TALLY_VOTE_START event containing admin_id, vote_id, and start timestamp when tally operation begins. Individual decrypted ballots are never logged or stored in plaintext. The system aggregates vote totals in memory and discards individual ballot contents immediately after counting. Audit records TALLY_VOTE_COMPLETE event containing admin_id, vote_id, aggregate result summary (totals only, not individual votes), and completion timestamp.
- Data Export / vote participation records: for each vote the member participated in, the export includes vote title, vote ID, and submission timestamp. The raw receipt token is not included in the export. Members who need to verify their ballot must use the receipt token from their original email.
- After HoF election results are published (or the vote is canceled), the system clears the `HoF_Nominated` flag from all members who held it during that cycle, resetting the flag for the next nomination cycle.

### A_Cancel_Vote

Access: Only admins can cancel a vote.

Story: As an admin, I can cancel a vote that has not yet had results published so that erroneous or compromised elections can be voided.

Success Criteria:

- Admin can cancel a vote in `draft`, `open`, or `closed` state. Votes in `published` state cannot be canceled.
- On cancellation: vote status set to `canceled`. All eligible members who have not yet voted receive a cancellation notification email. Already-cast ballots are retained in encrypted form for audit purposes but results are never published.
- Cancellation reason is required (free-text field, mandatory) and is audit-logged with admin ID, vote ID, reason, and timestamp.
- canceled votes are visible in vote history with status `canceled` and the cancellation reason displayed.

## 6.5 Email

### A_Send_Mailing_List_Email

Access: Only Admins and Event Organizers can send email to general mailing lists from the platform. Exception: the IFPA announce list (announce@footbag.org) may be sent to by any Tier 2+ member, as defined in M_Send_Announce_Email.

Story: As an admin, I can send announcements to a platform-configured mailing list so that I communicate with the community.

Success Criteria:

- Admin composes email and selects target list (newsletter, announcements, board-updates).
- Organization-wide announce list is retained; only Admins may send to general mailing lists through this story. Exception: the IFPA announce list (announce@footbag.org) may be sent to by any Tier 2+ member via M_Send_Announce_Email; the Admin-only rule applies to all other mailing lists managed through this story.
- System enumerates recipients from MailingListSubscription records for the chosen MailingList, applying subscription status.
- Sends to all subscribed members via outbox pattern.
- Email delivery respects bounce list.
- All sends logged to audit trail.
- All bulk emails include unsubscribe or preferences links.
- Delivery status visible: senders see sent, bounced, and suppressed counts.
- Each mailing list has a configurable outbound alias/from-identity (e.g., directors@…, sanctioning@…). This can be set to no-reply, a special case.
- Each sent mailing list email is archived (subject/body/sender/list/timestamp/recipient count) and browseable by admins.
- Email body is plain text (no HTML).
- No approval workflow is required; controls are permissions, audit logging, unsubscribe links, and rate limits where applicable.

### A_Manage_Mailing_Lists

Access: Only admins can view and manage mailing lists. The only exception is EO_Email_Participants.

Story: As an administrator, I can create, update, and archive mailing lists that are backed by MailingList and MailingListSubscription data objects, so that we can manage bulk email communications in a controlled and auditable way without hard-coding specific lists.

Success Criteria:

- The system seeds an initial set of core MailingList records (for example: newsletter, board-announcements, event-notifications, technical-updates, admin-alerts), but these are only an initial default set, not the full or fixed set of lists.
- Admins can create additional MailingList records at any time (for example: regional lists, project-specific lists), by specifying name, description, and whether the list is member-manageable or admin-only.
- For each MailingList, admins can view key analytics including total subscribers and counts by status (subscribed, unsubscribed, bounced, complained), based on MailingListSubscription records.
- Admins can change a MailingList’s status to archived so that it no longer appears in member subscription controls or new email send flows, while all historical mailing data and subscriptions remain preserved for audit and reporting.
- For member-manageable lists, subscription/unsubscription is primarily controlled by the member from their profile page; admins can only make limited manual adjustments in exceptional cases (for example to handle bounced or complaint states), and all such manual changes are audit-logged with admin identity, timestamp, and reason.
- For admin-only lists (for example admin-alerts), subscriptions are controlled by admin configuration or system roles rather than member toggles, and the rules for who is subscribed are clearly documented in the list metadata.

## 6.6 System Configuration

### A_View_Stripe_Config_And_Payments

Access: Only admins can view Stripe configuration and payment details.

Story: As an administrator, I can view a Stripe configuration and payments dashboard that shows test/live mode, webhook health, API key age, and recent payment volumes by category, so that I can quickly confirm that payments infrastructure is healthy and decide when to investigate deeper using the detailed payments and reconciliation views.

Success Criteria:

- The admin Stripe dashboard clearly shows whether the system is currently in test or live mode and when this mode was last changed.
- The dashboard shows webhook health, including the timestamp of the last successful webhook and counts of failures over a recent window (for example the last 24 hours), with obvious warning states when webhooks are failing or have been silent for too long.
- The dashboard shows API key information in a safe, non-sensitive way (for example key labels and age), and highlights when keys are older than a threshold or when rotation is recommended.
- The dashboard summarizes recent payment volume, broken down by category (donations, membership fees, event registrations) for a configurable time window (for example last 30 days), including both count and total amount.
- From this dashboard, admins can navigate directly to the “All Payments” view and the “Reconciliation Issues” view described in A_Reconcile_Payments for deeper inspection.
- The dashboard provides clear, explicit actions for key operations such as “View Webhook Logs”, with appropriate confirmations and warnings; all such actions are audit-logged with admin identity and timestamp.

### A_Configure_System_Parameters

Access: Only admins can configure system-wide parameters.

Story: As an admin, I can view and adjust key system parameters in one place so that policies remain consistent, small changes do not require code deployments, and system behavior matches IFPA’s current decisions. Note that some parameters must be configured by an AWS System Administrator instead.

Success Criteria:

- There is a single System Parameters admin view that shows all supported configuration settings grouped into clear sections (for example: Membership and Pricing, Donations and Payments, Email and Notifications, Data Retention and Cleanup, Grace Periods, System Health and Alarms, Session Timeout).
- All Administrator-configurable system parameters have normative default values defined in the Configurable Parameters subsection of this document. The initial database creation process must load those defaults into the corresponding tables. Defaults reflect IFPA rules where applicable, and otherwise reflect privacy, security, and legal-retention requirements.
- The Membership and Pricing section allows an admin to view and adjust: Tier 1 Lifetime price (USD). Tier 2 Annual price (USD). Tier 2 Lifetime price (USD).
- The Email and Notifications section allows an admin to view and adjust: Maximum email retry attempts for the outbox / notification sender (default: 5 attempts with exponential backoff; after max attempts the item is moved to a dead-letter queue/folder visible to admins). Time between outbox scans / notification runs (for example every 5 minutes) for SYS_Send_Email. "Pause sending" emergency toggle (default: off) that stops the worker from sending new outbox items while keeping newly enqueued items pending. Days-before-event for registration reminder emails in M_Register_For_Event (default: 7 days before event start). Two administrator-configurable days-before-tier-expiry reminder offsets (defaults: 30 and 7 days). Day-of expiry notification (T+0) is built in and not separately configurable.
- All parameters on this screen: Show current values and defaults, with short helper text explaining how each value is used (for example “Used by recurring donations job; do not set below X days without board approval”). Enforce safe ranges and validation so that admins cannot set obviously invalid values (for example negative days, zero retry count, or unparseable expressions). Are audit-logged when changed, including old value, new value, admin ID, and timestamp, and these changes appear in A_View_Audit_Logs / A_View_System_Health where appropriate.
- Changing any of these parameters does not require code deployment: the updated values are read from the SystemConfig data store and automatically picked up by the relevant jobs, flows, and admin views the next time they run.
- The Data Retention Configuration section allows an admin to view and adjust entity-specific retention periods enforced by SYS_Cleanup_Soft_Deleted_Records background job: Member account deletion grace period, Payment record compliance retention, Audit log retention, Ballot retention.
- Admin can create a new dues schedule entry with: tier product (eg: Tier 1 Lifetime), amount, currency, effectiveStartDate, and required reason (“official rule change”, “board decision”, etc.).
- Only one schedule entry per tier product may be active for a given effectiveStartDate.
- Price schedule changes are audit-logged with admin ID, old active price, new price, effectiveStartDate, reason, timestamp.
- Past entries are immutable/read-only (no edit/delete); admins can only supersede by adding a new entry.

### A_Manage_Admin_Role

Access: Only admins can grant or revoke the admin role for authorized members.

Story: As an admin, I can grant or revoke admin privileges so that I manage the admin team.

Success Criteria:

- Admin can select member and grant/revoke admin role.
- Granting admin requires: member has Tier 2 Lifetime or Tier 3 status, confirmation dialog, mandatory reason.
- Revoking admin requires: confirmation dialog, mandatory reason.
- Admin cannot revoke their own admin status (ensures there is always at least one admin).
- All role changes send email notification to affected member.
- All role changes audit-logged with admin ID, target member ID, action, reason, timestamp.
- Granting the admin role automatically subscribes the member to the Admin mailing list used for admin alerts.
- Revoking the admin role automatically unsubscribes the member from the Admin mailing list, without changing any of their other email subscriptions.

## 6.7 Configurable Parameters

Seed these defaults into the database-backed configuration store during initial database creation. Admins may change values only within validated ranges; all changes must be audit-logged. Story text may reference these defaults but must not redefine them. IFPA-derived values reflect the IFPA Memberships document (authoritative source). For membership pricing, the keys below are `system_config.config_key` literals.

### Membership Pricing / Dues (IFPA-derived)

- `tier1_lifetime_price_cents = 1000` (Tier 1 Lifetime dues; integer cents; valid `> 0`)
- `tier2_annual_price_cents = 2500` (Tier 2 Annual dues; integer cents; valid `> 0`)
- `tier2_lifetime_price_cents = 15000` (Tier 2 Lifetime dues; integer cents; valid `> 0`)

### Membership Windows / Lifecycle

- `vouch_window_days = 14 days` (valid `>= 1`)
- `tier_expiry_reminder_days_1 = 30 days` (valid `>= 1`)
- `tier_expiry_reminder_days_2 = 7 days` (valid `>= 1` and `< tier_expiry_reminder_days_1`)
- `tier_expiry_grace_days = 0 days` (valid `>= 0`)

### Email / Notifications / Outbox

- `outbox_max_retry_attempts = 5`
- `outbox_poll_interval_minutes = 5 minutes`
- `email_sending_paused = 0` (admin-only emergency kill switch; DB literal `0/1`)
- `event_registration_reminder_days = 7 days`

### Auth / Security Tokens

- `email_verify_expiry_hours = 24 hours`
- `password_reset_expiry_hours = 1 hour`
- `token_cleanup_threshold_days = 7 days`
- `data_export_link_expiry_hours = 72` (hours before a personal data export download link expires)
- `login_rate_limit_max_attempts = 10` (maximum failed login attempts within the window before the account is locked)
- `login_rate_limit_window_minutes = 15` (sliding window in minutes for counting failed attempts)
- `login_cooldown_minutes = 30` (lockout duration after threshold is exceeded)
- `password_reset_rate_limit_max_attempts = 5` (maximum password reset requests per email address within the window before requests are silently rate-limited)
- `password_reset_rate_limit_window_minutes = 60` (sliding window in minutes for counting password reset requests per email)
- `jwt_expiry_hours = 24` (lifetime of the main site session JWT; governs archive access expiry since no separate archive session is issued)
- `photo_upload_rate_limit_per_hour = 10` (maximum photo uploads per member per hour)
- `video_submission_rate_limit_per_hour = 5` (maximum video link submissions per member per hour)
- `media_flag_rate_limit_per_hour = 10` (maximum media flags per member per hour to prevent abuse)

### Retention / Cleanup

- `member_cleanup_grace_days = 90 days` (aligns with `M_Delete_Account` and `SYS_Cleanup_Soft_Deleted_Records`)
- `deceased_cleanup_grace_days = 30 days` (grace period before contact data is cleared from a deceased member record, per `A_Mark_Member_Deceased`; allows correction of erroneous deceased flags)
- `payment_retention_days = 2555 days` (minimum 7 years; do not reduce below minimum)
- `audit_retention_days = 2555 days`
- `ballot_retention_days = 2555 days` (governance/audit defensibility baseline)
- `reconciliation_expiry_days = 90 days`
- `reconciliation_summary_interval_days = 7` (cadence in days for the automated reconciliation digest email sent to admins)
- `primary_snapshot_version_days = 30` (number of days of point-in-time snapshot versions retained in the primary S3 backup bucket; governs the S3 versioning lifecycle setting)
- `cross_region_backup_retention_days = 90` (Object Lock retention window for backup objects in the cross-region disaster-recovery bucket)
- `continuous_backup_interval_minutes = 5` (interval in minutes between continuous SQLite backup runs)

## 6.8 Monitoring and Audit

### A_View_Dashboard

Access: Only admin users can view the admin dashboard.

Story: As an admin, I can view a consolidated dashboard Work Queue, an ordered list of items generated by the system so that I can quickly see what needs my attention.

Success Criteria:

- Dashboard shows a summarized Work Queue panel with details such as: pending event approvals, flagged media, election tasks (if any), payment reconciliation discrepancies, recurring donation failures, club without a leader, event without an organizer, email outbox failures/dead-letter items, any active unacknowledged alarms (acknowledged alarms are visible in A_Acknowledge_Alarm view but not counted in the dashboard summary), vote management.
- This dashboard does NOT show information that requires AWS console access (which is instead intended for the System Administrator role).
- Each count links to the corresponding detailed queue or screen (for example, event approval queue, moderation queue, payment reconciliation view).
- Items are grouped by category (Events, Media, Membership, Payments, Elections, System) with clear labels.
- Dashboard highlights any categories with urgent items (for example, failed backups, alarmed cost thresholds, many failed payments, email outbox dead-letter growth) using a simple visual indicator.
- Admin sees only data they are permitted to act on; no member personal data beyond what existing admin stories allow.
- Dashboard view is read-only; all state changes happen in the underlying queues and flows already defined in other admin stories.

### A_View_System_Health

Access: Only admins can view overall system health, cost, and performance metrics in the application UI. Important note: AWS/System Administrator features related to AWS health/cost/performance (including AWS console/CloudWatch access and infrastructure operations) require special access and are out of scope for this document. We describe only Application Admin role features here, not AWS System Administrator features.

Story: As an admin, I receive alerts on flagged media, webhook failures, backups, and budget alarms so that I can act quickly.

Success Criteria:

- Grid of metric cards: CPU, Memory, Storage, Backup Status, Cost.
- Refresh button with auto-refresh toggle (default: every 5 minutes).
- No direct links to AWS consoles (including CloudWatch), CLI tooling, or infrastructure controls are exposed in the Application Administrator UI.
- Health view shows at least: Email delivery status (bounce and complaint rates). Email outbox status: pending, sent, failed, and dead-letter counts (for a configurable recent window), plus whether “pause sending” is currently enabled. Backup job status (last run time and success or failure). Origin availability / maintenance mode status (normal vs maintenance page), including current origin 5xx rate (or equivalent) and when the maintenance page was last served. Storage usage (e.g., S3 usage and trends).
- Monthly cost projection vs budget (current spend and projected end-month spend).

### A_View_Audit_Logs

Access: Only admins can view detailed audit logs.

Story: As an admin, I can view and filter audit logs and periodic summaries so that I maintain oversight of key actions and investigate issues.

Success Criteria:

- Audit log view lists entries with at least: timestamp, actor (admin, system, or member), action type, affected entity (such as member, event, media, payment, election), and a short description or reason where available.
- Entries are sorted by timestamp, newest first by default.
- Admin can filter logs by: date range (from/to); topic/category (for example: membership changes, pricing changes, elections, content moderation, payments, system alarms, configuration changes); actor type (admin vs system vs member).
- Admin cannot search logs via the app in Phase One but must instead use an external tool if searching logs is required operationally.
- Audit coverage includes at least: membership tier changes, pricing updates, event sanction approvals, media takedown decisions, election operations (create, publish, decrypt), admin role changes, alarm acknowledgments, and system cleanup or reconciliation processes.
- Monthly summary view shows counts per category (for example: number of tier changes, number of event approvals, number of takedowns) to support lightweight reporting.
- Logs retain limited identifiers necessary for traceability (IDs, not email addresses), consistent with privacy rules in Global Behaviors and Technical Requirements.
- All audit log data is read-only; no UI allows editing or deleting existing entries.

### A_Acknowledge_Alarm

Access: Only admins can acknowledge platform alarms and document responses.

Story: As an admin, I can acknowledge AWS alarms so that I record incident handling.

Success Criteria:

- Alarm dashboard with acknowledge action.
- Acknowledgment recorded in audit log.
- Alarms include at least: Abnormally high email bounce or complaint rates. Backup failures or missed runs. Approaching or exceeding monthly cost thresholds.
- When an alarm is acknowledged, the system records: Who acknowledged it. When it was acknowledged. An optional note describing actions taken.

# 7. Background System Jobs

System jobs are not User Stories. Instead they represent automated processes that execute on schedules (a DevOps concern), or in response to system events (webhooks). All system job actions are logged so that they can be viewed via the admin dashboard. These jobs are required in order to ensure the success criteria for the User Stories given above are met.

### SYS_Check_Tier_Expiry

Access: This scheduled process runs under the system role.

Story: The system automatically checks membership tier expiry every day, and sends any required renewal or downgrade notifications, so that Tier 1 or 2 Annual stay in sync with their rules without manual admin work.

Success Criteria:

- System runs a daily job that evaluates all Tier 1 and 2 Annual memberships (and any other expiring tiers configured in System Parameters) for upcoming and past expiry, using two configured pre-expiry reminder offsets and grace-period settings (for example T-30 and T-7), plus a built-in day-of expiry notification (T+0).
- For each member with an expiring tier, the job determines whether a reminder is due today based on those configured offsets and whether a reminder for that offset has already been sent; if due, it enqueues a renewal reminder email via the notification outbox.
- Reminder emails include a clear call-to-action with current tier, expiry date, and a renewal link, and are never sent more than once per day per member or more than once per configured offset.
- Reminders are not sent for members whose expiring tier has already been renewed or downgraded, and the job respects member email preferences and unsubscribes for the relevant reminder category.
- When an Tier 1 Annual membership has passed its expiry date, the job automatically adjusts the member’s tier to Tier 0.
- Each automatic downgrade writes an audit-log entry including member ID, old tier, new tier, reason "tier1_annual_expired", and timestamp, and enqueues (or updates) a tier-expiry notification email for that day so that members are informed once, without duplicate messages.
- Tier 2 Annual fallback logic: When a Tier 2 Annual membership expires (tierExpiryDate = today), the job performs an atomic update, setting tierStatus = 'tier1_lifetime'. Fallback transitions are audit-logged with: member ID, old tier (`tier2_annual`), old expiry date, new tier (`tier1_lifetime`), reason `tier2_annual_expired`, timestamp.
- All reminder sending and automatic tier-expiry processing performed by this job are logged to CloudWatch (or equivalent monitoring), including counts and failure metrics.

### SYS_Send_Email

Access: This scheduled polling process runs under the system role to send queued emails by polling the email outbox on a configurable interval (default: every 5 minutes). Only admins can view delivery logs.

Story: The system automatically sends transactional emails so that members stay informed of important events.

Success Criteria:

- System sends emails for: account registration, email verification, password reset, tier upgrade, tier expiry, payment receipt, event registration confirmation, club membership changes, co-organizer/co-leader additions, and other cases. As this is a flexible list, it is not necessary to hard-code all cases now.
- All emails sent via SES with proper headers, unsubscribe links, and deliverability tracking.
- Worker respects the admin Pause Sending toggle: when enabled, the worker does not attempt new sends, but enqueued items remain pending.
- Emails are sent only via the outbox pattern: request-time controllers enqueue outbox entries and never call SES directly; a background worker polls the outbox on a configurable interval (default: every 5 minutes), sends via SES, and records sent/failed status.
- Failed email deliveries are logged and retried up to 5 times with exponential backoff; after the maximum retry count the outbox item is moved to a dead-letter queue/folder for admin review and possible replay.
- Email templates are stored as plain text in the database and are editable by Administrators via the configuration interface. Template changes are audit-logged. 
- Different mailing lists can have different from addresses configured and this job will use them. The special no-reply from address will be an option. Otherwise, all other reply addresses must go to a real inbox for a human to receive replies.
- All sent emails are logged to CloudWatch with template ID, member ID, outbox message ID, timestamp, and delivery result (do not log raw email addresses or full subject lines).

### SYS_Open_Vote

Access: This scheduled process runs under the system role.

Story: The system automatically opens votes at their configured open_datetime so that voting begins on schedule without manual admin action.

Success Criteria:

- System runs a job (at minimum hourly) that checks all votes in `draft` status with open_datetime <= now (UTC).
- For each such vote, the job transitions vote.status to `open` and writes eligibility snapshot rows to `vote_eligibility_snapshot_base` (same logic as A_Open_Vote).
- The system sends notification to all eligible members that the vote is now open (if configured).
- Each transition is audit-logged: vote_id, old status, new status, eligible member count, job run timestamp.
- An admin-alerts email is sent for each automatically opened vote.

### SYS_Close_Vote

Access: This scheduled daily process runs under the system role.

Story: The system automatically transitions votes from `open` to `closed` when their close_datetime has passed, so that tally operations can proceed without manual admin intervention.

Success Criteria:

- System runs a daily job (or more frequently — at minimum once per hour is recommended) that checks all votes with status `open` and close_datetime in the past (UTC).
- For each such vote, the job sets vote.status to `closed` and records a close timestamp.
- The job audit-logs each transition: vote_id, old status (`open`), new status (`closed`), close_datetime, job run timestamp.
- The system sends an email notification to the admin-alerts mailing list when a vote is automatically closed, including the vote title and vote ID.
- No member notifications are sent at close time (only at result publication via A_Publish_Vote_Results).

### SYS_Process_One_Time_Payments

Access: This event-driven process runs under the system role when Stripe sends payment-related webhook events. Only admins can view logs and failure metrics.

Story: The system handles Stripe webhook events for one-time payments (membership dues, event registrations, one-time donations) so that local payment records are kept in sync with Stripe.

Success Criteria:

- On payment_intent.succeeded: local payment record transitions to `completed`. Tier upgrade or event registration confirmation applied as appropriate. Receipt email enqueued to member. Audit-logged with payment_intent_id, amount, currency, and timestamp.
- On payment_intent.payment_failed: local payment record transitions to `failed`. Failure notification email enqueued to member. Audit-logged.
- On charge.refunded: local payment record transitions to `refunded`. Audit-logged with Stripe charge ID, refund amount, currency, and timestamp. No automatic tier or registration changes are applied by the platform; any required access changes are handled manually by admins via A_Override_Member_Data using "payment issue resolution" as the reason.
- All one-time payment webhook processing is idempotent via the stripe_events table (keyed on Stripe event_id), consistent with the global Payment Processing Guarantees.
- All events audit-logged with payment_intent_id, member_id, event type, old status, new status, and timestamp.

### SYS_Process_Recurring_Donations

Access: This event-driven process runs under the system role when Stripe sends subscription-related webhook events. Only admins can view logs and failure metrics. Recurring donation billing schedules are owned entirely by Stripe; the platform does not drive charges.

Story: The system handles Stripe Subscription webhook events for recurring donations so that local payment records, member-facing history, and admin reconciliation data are kept in sync with Stripe's billing activity.

Success Criteria:

- The platform does not run a scheduled cron job to initiate recurring donation charges. Stripe owns the annual billing cycle and all retry logic based on the Stripe Billing dunning configuration set by a System Administrator in the Stripe Dashboard.
- On invoice.payment_succeeded for a donation subscription: the system creates a new local payment record (linked to the existing donation subscription record via stripeSubscriptionId), enqueues a receipt email to the member, and audit-logs the event with subscription_id, invoice_id, amount, and timestamp.
- On invoice.payment_failed for a donation subscription: the system updates the local subscription status to past_due and enqueues a failure notification email to the member. No retry logic is implemented in the platform; Stripe's configured dunning schedule governs further retry attempts.
- On customer.subscription.deleted for a donation subscription (triggered when Stripe exhausts all retries, or when the member cancels via the platform): the system sets the local subscription status to canceled, enqueues a final notification email to the member and an admin alert, and audit-logs the cancellation with subscription_id and reason.
- On customer.subscription.updated (e.g., amount or status changes made in the Stripe Dashboard by a System Administrator): the system updates the local subscription record to reflect the new state and audit-logs the change.
- All subscription webhook processing is idempotent via the stripe_events table (keyed on Stripe event_id) consistent with the global Payment Processing Guarantees.
- All subscription lifecycle events are audit-logged with subscription_id, invoice_id (where applicable), member_id, event type, old status, new status, and timestamp.

### SYS_Reconcile_Payments_Nightly

Access: This nightly process runs under the system role to reconcile payments with external providers. Only admins can view its reports.

Story: The system automatically reconciles local payment records against Stripe every night so that discrepancies are detected promptly across both one-time payments and recurring donation subscriptions.

Success Criteria:

System runs nightly cron job at 2 AM UTC in two passes:

Pass 1 — One-time payments: Compares local payment records (membership dues, event registrations, one-time donations) against Stripe PaymentIntent records for the reconciliation window. Discrepancies flagged: local records with no matching Stripe PaymentIntent, Stripe PaymentIntents with no matching local record, amount or status mismatches.

Pass 2 — Recurring donation subscriptions: Compares local donation subscription records against Stripe Subscription objects and their associated Invoice records. Discrepancies flagged: active local subscriptions with no matching active Stripe Subscription, Stripe Subscriptions with no matching local record, local subscription status out of sync with Stripe status (e.g., local shows active but Stripe shows canceled or past_due), Invoice charges recorded in Stripe but missing as local payment records.

Amount discrepancy checks compare both the amount AND the currency field: a local record and a Stripe record for the same payment_intent_id that have matching amounts but different currency values MUST be flagged as a discrepancy. Reconciliation reports display amounts alongside currency codes.

Discrepancies from both passes are stored as durable reconciliation issues with status (Outstanding/Resolved), resolver, timestamps, and resolution notes; shown in admin dashboard; retained 90 days.

### SYS_Cleanup_Expired_Tokens

Access: This scheduled process runs under the system role. Only admins can view its summary logs.

Story: The system deletes expired or consumed email verification and password reset token rows so that token tables remain small and old tokens cannot be reused.

Success Criteria:

- System runs a daily job to delete token rows that are expired or consumed and older than a configured cleanup threshold (default: 7 days).
- Cleanup covers at least: email verification tokens and password reset tokens.
- Each run logs counts of deleted rows by token type and the oldest remaining token age (if any) to CloudWatch (or equivalent monitoring).
- Cleanup is safe and idempotent (re-running does not affect correctness).

### SYS_Cleanup_Soft_Deleted_Records

Access: This scheduled process runs under the system role to purge member records after their deletion grace period. Only admins can view or adjust its configuration and logs.

Story: The system anonymizes member records after the deletion grace period so that PII is removed while referential integrity and audit history are preserved.

Success Criteria:

- System runs a daily cron job.
- Member Cleanup (admin-configurable grace period default: 90 days, parameter key: member_cleanup_grace_days): After member_cleanup_grace_days days past deletedAt timestamp, the job performs the following selective operations. PII purge: credential and contact fields (email, phone, passwordHash) are set to NULL. The member row is retained as an anonymized record for referential integrity. For retained non-nullable identity/location fields, the application writes anonymized placeholder values where required by schema. HoF/BAP flagged members receive the same PII NULLing treatment; however, their display name, bio, honor badges (HoF, BAP), and event result history are preserved to honor community history.
- Photo Cleanup (zero grace period): no job concern required for this. No referential integrity concerns because photos are leaf nodes in data model. When member deletes account, member's photos are deleted immediately.
- Payment Record Cleanup (7-year retention for compliance). This period satisfies financial compliance requirements while enabling GDPR data deletion.
- Vote Ballot Preservation (7-year retention).
- Clubs are NEVER hard deleted (historical record preservation); instead they are archived. 
- Events with result rows are never hard-deleted once official event-result rows exist for that event (historical record preservation).
- Events and clubs can be marked archived or inactive via admin actions but database records remain indefinitely. When an event organizer or club leader deletes an account, leadership foreign keys continue to point to the retained/anonymized member record to preserve historical leadership. For non-HoF/BAP members, the display name may be anonymized to "Deleted Member" where required by schema/app policy; for HoF/BAP members, preserve displayName and bio per the deletion policy. Historical event results, participant lists, and club rosters remain intact for community record.
- Each run writes a comprehensive summary entry to application logs and audit trail including: job start/end timestamps, entity types processed (members, payments, ballots), counts per entity type (records eligible for cleanup, records anonymized, records preserved due to special rules, records skipped due to errors), errors encountered with entity IDs and error messages.

### SYS_Rebuild_Hashtag_Stats

Access: This scheduled process runs under the system role.

Story: The System recomputes hashtag usage statistics daily so that member-facing pages can show fast, accurate counts for popular hashtags in real time. Hashtag usage can be sorted by popularity

Success Criteria:

- A scheduled background job runs once per day to recompute aggregated hashtag usage counts from recent media.
- The job reads MediaItem records, normalizes each tag, and updates a stats structure containing {tag, usageCount, lastUpdated}.
- The stats are stored in a format that can be read quickly by the Browse Hashtags page and any “popular tags” UI elements.
- If the job fails, existing stats remain in place and the failure is logged for later investigation.
- The system exposes basic metrics for the job (run time, success/failure) to operations/admins.

### SYS_Handle_Stripe_Webhooks
Access: This event-driven process runs under the system role when Stripe sends webhook events. Only admins can view logs and failure metrics.

Story: The system validates and processes Stripe webhook events so that payments are confirmed reliably and local records reflect Stripe’s source of truth.

Success Criteria:

- Webhook handler validates Stripe webhook signatures using the configured webhook secret.
- Processing is idempotent (replayed events do not double-apply tier changes or create duplicate payment records).
- On successful payment events, the system updates the relevant local payment records and triggers the correct downstream effects (e.g., membership tier upgrades, receipts) consistent with the relevant member/admin stories.
- Failures are logged with sufficient metadata for debugging, and webhook failure counts/time-since-last-success are surfaced in the admin Stripe dashboard health indicators.

### SYS_Handle_SES_Bounce_And_Complaint_Webhooks
Access: This event-driven process runs under the system role when SES reports bounces/complaints. Only admins can view detailed logs.

Story: The system processes SES bounce/complaint notifications so that mailing lists remain healthy and future sends avoid problematic addresses.

Success Criteria:

- SES webhook events update MailingListSubscription status (bounced/complained) and any global member email suppression as applicable.
- Member subscriptions stay consistent with subscription status so future sends skip suppressed addresses.
- Bounce/complaint rates are tracked and can trigger alarms.

### SYS_Nightly_Backup_Sync
Access: This process runs under the system role.

Story: The system performs a nightly backup sync so that recovery is possible within the defined RPO/RTO.

Success Criteria:

- Nightly backups are incremental and designed to complete quickly; the run includes a nightly integrity verification step appropriate to S3 (at minimum: verify required prefixes and objects exist).
- Failures are logged and raise an alarm; job metadata (last-run time, duration, success/failure) is recorded for admin visibility.
- A nightly job syncs the primary S3 bucket to a separate cross-region backup bucket (disaster recovery target) and records last-run time, duration, and success/failure status for admin visibility.
- The backup bucket is protected with S3 Object Lock (WORM) and lifecycle rules to enforce retention.
- Backup retention defaults (admin-configurable): ≤90 days for general backup objects/snapshots; ≤7 years for audit logs.
- Recovery objectives (admin-visible targets): Disaster recovery (cross-region) targets are RTO = 2 hours, RPO = 24 hours. Primary recovery uses the frequent SQLite snapshot mechanism (see SYS_Continuous_Database_Backup) for a much smaller RPO under common failure modes.
- For key datasets (at minimum audit logs and payments), cross-region replication runs continuously; the nightly job also acts as an integrity verification pass (e.g., verifies expected objects/prefixes exist in the backup bucket).
- Failures are logged and raise an alarm; status is shown in A_View_System_Health as Backup job status.

### SYS_Continuous_Database_Backup

Access: This process runs under the system role on a configurable interval (default: every 5 minutes; see `continuous_backup_interval_minutes`).

Story: The system continuously backs up the SQLite database to the primary S3 bucket so that recovery is possible with minimal data loss from common issues like corruption, bugs, or accidental deletion. This is the most frequently used recovery mechanism and is separate from the nightly cross-region disaster recovery sync.

Success Criteria:

- Background worker runs every 5 minutes.
- Process executes: (1) WAL checkpoint commits pending writes to the main database file, (2) SQLite backup API creates a consistent point-in-time snapshot, (3) Upload snapshot to primary S3 bucket with retry (3 attempts, exponential backoff), (4) Update health timestamp. The technical implementation of the WAL checkpoint (including specific PRAGMA commands and busy-timeout handling) is specified in Design Decisions.
- S3 versioning enabled on primary bucket provides 30-day point-in-time recovery (restore any snapshot from last 30 days).
- Upload failures trigger retry with exponential backoff (max 3 attempts per cycle).
- After 3 consecutive failures, alarm raised and logged for admin investigation.
- Health timestamp tracks last successful backup for monitoring dashboard.
- Cost remains minimal.
- Backup does not interfere with application performance (WAL mode allows concurrent reads).
- Container shutdown waits for in-flight backup to complete before final upload and exit.

### SYS_Cleanup_Static_Asset_Versions

Access: This process runs under the system role.

Story: The system runs a daily (off-peak) cleanup of old static asset versions (or uses an equivalent S3 Lifecycle expiration rule) so storage does not grow without bound while preserving rollback safety.

Success Criteria:

The job deletes obsolete content-hash asset versions older than the configured retention window (default: 90 days) to preserve rollback capability while controlling storage growth and cost. All deletions are logged and failures raise alarms. Retention window (default: 90 days) is admin-configurable.

# 8. System Administrator Stories

System Administrator stories are not application User Stories, but instead they are DevOps actions performed by technical staff with access to the AWS console, CLI, and related operational tooling. This summary is not an exhaustive list, but it clarifies the boundary between what an Application Administrator (user-role) can do and what must be handled by a System Administrator (developer role) responsible for infrastructure provisioning, deployment operations, and ongoing platform maintenance. All System Administrator AWS actions are logged via CloudTrail.

The System Administrator role covers the operational work required to deploy, secure, and operate the platform in production. Responsibilities include provisioning and maintaining AWS infrastructure (e.g., Lightsail, S3, CloudFront, SES, IAM, Parameter Store/KMS) using infrastructure as code; managing environments and deployments (CI/CD, configuration, rollbacks); rotating and safeguarding secrets/keys and webhook credentials; configuring domains/DNS and TLS certificates; SQLite data storage (versioning, backups, restore testing, and configuration); configuring and monitoring scheduled/background jobs; setting up logging/metrics/alerts and cost controls; applying security updates and access reviews; and leading incident response and operational troubleshooting.

**END OF User Stories DOCUMENT**