export interface TelegramBotConfig {
    token: string;
    apiBaseUrl?: string;
    pollingTimeout?: number;
    pollingLimit?: number;
    allowedUpdates?: string[];
    webhookUrl?: string;
    webhookMaxConnections?: number;
    webhookSecretToken?: string;
    dropPendingUpdates?: boolean;
    botInfoCacheTTL?: number;
    messageCacheSize?: number;
    fileCacheSize?: number;
    rateLimitDefault?: number;
    rateLimitWindow?: number;
    retryOnError?: boolean;
    maxRetries?: number;
}

export interface Update {
    update_id: number;
    message?: Message;
    edited_message?: Message;
    channel_post?: Message;
    edited_channel_post?: Message;
    inline_query?: InlineQuery;
    chosen_inline_result?: ChosenInlineResult;
    callback_query?: CallbackQuery;
    shipping_query?: ShippingQuery;
    pre_checkout_query?: PreCheckoutQuery;
    poll?: Poll;
    poll_answer?: PollAnswer;
    my_chat_member?: ChatMemberUpdated;
    chat_member?: ChatMemberUpdated;
    chat_join_request?: ChatJoinRequest;
    business_connection?: BusinessConnection;
    business_message?: Message;
    edited_business_message?: Message;
    deleted_business_messages?: BusinessMessagesDeleted;
    message_reaction?: MessageReactionUpdated;
    message_reaction_count?: MessageReactionCountUpdated;
    chat_boost?: ChatBoostUpdated;
    removed_chat_boost?: ChatBoostRemoved;
    guest_message?: Message;
    managed_bot?: ManagedBotUpdated;
    subscription?: BotSubscriptionUpdated;
    stopped_message_generation?: MessageGenerationStopped;
    purchased_paid_media?: PaidMediaPurchased;
}

export interface MessageEntity {
    type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'blockquote' | 'expandable_blockquote' | 'code' | 'pre' | 'text_link' | 'text_mention' | 'custom_emoji' | 'date_time';
    offset: number;
    length: number;
    url?: string;
    user?: User;
    language?: string;
    custom_emoji_id?: string;
}

export interface Message {
    message_id: number;
    message_thread_id?: number;
    from?: User;
    sender_chat?: Chat;
    date: number;
    chat: Chat;
    forward_origin?: MessageOrigin;
    is_topic_message?: boolean;
    reply_to_message?: Message;
    external_reply?: ExternalReplyInfo;
    quote?: any;
    reply_to_story?: any;
    via_bot?: User;
    guest_bot_caller_user?: User;
    guest_bot_caller_chat?: Chat;
    guest_query_id?: string;
    receiver_user?: User;
    ephemeral_message_id?: number;
    edit_date?: number;
    has_protected_content?: boolean;
    is_from_offline?: boolean;
    media_group_id?: string;
    author_signature?: string;
    text?: string;
    entities?: MessageEntity[];
    link_preview_options?: any;
    effect_id?: string;
    rich_message?: RichMessage;
    animation?: Animation;
    audio?: Audio;
    document?: Document;
    photo?: PhotoSize[];
    sticker?: Sticker;
    story?: any;
    video?: Video;
    video_note?: VideoNote;
    voice?: Voice;
    live_photo?: LivePhoto;
    caption?: string;
    caption_entities?: MessageEntity[];
    has_media_spoiler?: boolean;
    show_caption_above_media?: boolean;
    contact?: Contact;
    dice?: Dice;
    game?: Game;
    poll?: Poll;
    venue?: Venue;
    location?: Location;
    new_chat_members?: User[];
    left_chat_member?: User;
    new_chat_title?: string;
    new_chat_photo?: PhotoSize[];
    delete_chat_photo?: boolean;
    group_chat_created?: boolean;
    supergroup_chat_created?: boolean;
    channel_chat_created?: boolean;
    message_auto_delete_timer_changed?: any;
    migrate_to_chat_id?: number;
    migrate_from_chat_id?: number;
    pinned_message?: Message;
    invoice?: Invoice;
    successful_payment?: SuccessfulPayment;
    users_shared?: any;
    chat_shared?: any;
    connected_website?: string;
    write_access_allowed?: any;
    passport_data?: any;
    proximity_alert_triggered?: any;
    boost_added?: any;
    forum_topic_created?: ForumTopicCreated;
    forum_topic_edited?: ForumTopicEdited;
    forum_topic_closed?: ForumTopicClosed;
    forum_topic_reopened?: ForumTopicReopened;
    general_forum_topic_hidden?: GeneralForumTopicHidden;
    general_forum_topic_unhidden?: GeneralForumTopicUnhidden;
    giveaway_created?: any;
    giveaway?: any;
    giveaway_winners?: any;
    giveaway_completed?: any;
    video_chat_scheduled?: any;
    video_chat_started?: any;
    video_chat_ended?: any;
    video_chat_participants_invited?: any;
    web_app_data?: any;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    sender_tag?: string;
    community_chat_added?: CommunityChatAdded;
    community_chat_joined?: CommunityChatJoined;
    community_chat_removed?: CommunityChatRemoved;
}

export interface User {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
    added_to_attachment_menu?: boolean;
    can_join_groups?: boolean;
    can_read_all_group_messages?: boolean;
    supports_inline_queries?: boolean;
    supports_guest_queries?: boolean;
    supports_join_request_queries?: boolean;
    can_connect_to_business?: boolean;
    has_main_web_app?: boolean;
}

export interface Chat {
    id: number;
    type: 'private' | 'group' | 'supergroup' | 'channel';
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
    is_forum?: boolean;
    photo?: ChatPhoto;
    active_usernames?: string[];
    birthdate?: any;
    business_intro?: any;
    business_location?: any;
    business_opening_hours?: any;
    personal_chat?: Chat;
    available_reactions?: any[];
    accent_color_id?: number;
    background_custom_emoji_id?: string;
    profile_accent_color_id?: number;
    profile_background_custom_emoji_id?: string;
    emoji_status_custom_emoji_id?: string;
    emoji_status_expiration_date?: number;
    bio?: string;
    has_private_forwards?: boolean;
    has_restricted_voice_and_video_messages?: boolean;
    join_to_send_messages?: boolean;
    join_by_request?: boolean;
    description?: string;
    invite_link?: string;
    pinned_message?: Message;
    permissions?: ChatPermissions;
    can_send_gift?: boolean;
    can_send_paid_media?: boolean;
    slow_mode_delay?: number;
    message_auto_delete_time?: number;
    has_protected_content?: boolean;
    sticker_set_name?: string;
    can_set_sticker_set?: boolean;
    linked_chat_id?: number;
    location?: ChatLocation;
}

export interface ChatPhoto {
    small_file_id: string;
    small_file_unique_id: string;
    big_file_id: string;
    big_file_unique_id: string;
}

export interface ChatLocation {
    location: Location;
    address: string;
}

export interface File {
    file_id: string;
    file_unique_id: string;
    file_size?: number;
    file_path?: string;
}

export interface InputFile {
    source: Buffer | Uint8Array | string | Blob;
    filename?: string;
}

export interface MessageId {
    message_id: number;
}

export interface PhotoSize {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    file_size?: number;
}

export interface Animation {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    duration: number;
    thumbnail?: PhotoSize;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
}

export interface Audio {
    file_id: string;
    file_unique_id: string;
    duration: number;
    performer?: string;
    title?: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
    thumbnail?: PhotoSize;
}

export interface Document {
    file_id: string;
    file_unique_id: string;
    thumbnail?: PhotoSize;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
}

export interface Video {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    duration: number;
    thumbnail?: PhotoSize;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
}

export interface VideoNote {
    file_id: string;
    file_unique_id: string;
    length: number;
    duration: number;
    thumbnail?: PhotoSize;
    file_size?: number;
}

export interface Voice {
    file_id: string;
    file_unique_id: string;
    duration: number;
    mime_type?: string;
    file_size?: number;
}

export interface Sticker {
    file_id: string;
    file_unique_id: string;
    type: 'regular' | 'mask' | 'custom_emoji';
    width: number;
    height: number;
    is_animated: boolean;
    is_video: boolean;
    thumbnail?: PhotoSize;
    emoji?: string;
    set_name?: string;
    premium_animation?: File;
    mask_position?: any;
    custom_emoji_id?: string;
    needs_repainting?: boolean;
    file_size?: number;
}

export interface StickerSet {
    name: string;
    title: string;
    sticker_type: 'regular' | 'mask' | 'custom_emoji';
    stickers: Sticker[];
    thumbnail?: PhotoSize;
}

export interface Contact {
    phone_number: string;
    first_name: string;
    last_name?: string;
    user_id?: number;
    vcard?: string;
}

export interface Dice {
    emoji: string;
    value: number;
}

export interface Game {
    title: string;
    description: string;
    photo: PhotoSize[];
    text?: string;
    text_entities?: MessageEntity[];
    animation?: Animation;
}

export interface Poll {
    id: string;
    question: string;
    question_entities?: MessageEntity[];
    options: PollOption[];
    total_voter_count: number;
    is_closed: boolean;
    is_anonymous: boolean;
    type: 'regular' | 'quiz';
    allows_multiple_answers: boolean;
    allows_revoting?: boolean;
    correct_option_ids?: number[];
    correct_option_id?: number;
    explanation?: string;
    explanation_entities?: MessageEntity[];
    explanation_media?: PollMedia;
    open_period?: number;
    close_date?: number;
    description?: string;
    description_entities?: MessageEntity[];
    media?: PollMedia;
    members_only?: boolean;
    country_codes?: string[];
}

export interface PollOption {
    persistent_id?: string;
    text: string;
    text_entities?: MessageEntity[];
    media?: PollMedia;
    voter_count: number;
    added_by_user?: User;
    added_by_chat?: Chat;
    addition_date?: number;
}

export interface PollAnswer {
    poll_id: string;
    user: User;
    option_ids: number[];
}

export interface Location {
    longitude: number;
    latitude: number;
    horizontal_accuracy?: number;
    live_period?: number;
    heading?: number;
    proximity_alert_radius?: number;
}

export interface Venue {
    location: Location;
    title: string;
    address: string;
    foursquare_id?: string;
    foursquare_type?: string;
    google_place_id?: string;
    google_place_type?: string;
}

export interface Invoice {
    title: string;
    description: string;
    start_parameter: string;
    currency: string;
    total_amount: number;
}

export interface SuccessfulPayment {
    currency: string;
    total_amount: number;
    invoice_payload: string;
    shipping_option_id?: string;
    order_info?: any;
    telegram_payment_charge_id: string;
    provider_payment_charge_id: string;
}

export interface BotCommand {
    command: string;
    description: string;
    is_ephemeral?: boolean;
}

export interface BotCommandScope {
    type: string;
    chat_id?: number;
    user_id?: number;
}

export interface BotName {
    name: string;
}

export interface BotDescription {
    description: string;
}

export interface BotShortDescription {
    short_description: string;
}

export interface WebhookInfo {
    url: string;
    has_custom_certificate: boolean;
    pending_update_count: number;
    ip_address?: string;
    last_error_date?: number;
    last_error_message?: string;
    last_synchronization_error_date?: number;
    max_connections?: number;
    allowed_updates?: string[];
}

export interface MenuButton {
    type: 'commands' | 'web_app' | 'default';
    text?: string;
    web_app?: any;
}

export interface ChatPermissions {
    can_send_messages?: boolean;
    can_send_audios?: boolean;
    can_send_documents?: boolean;
    can_send_photos?: boolean;
    can_send_videos?: boolean;
    can_send_video_notes?: boolean;
    can_send_voice_notes?: boolean;
    can_send_polls?: boolean;
    can_send_other_messages?: boolean;
    can_add_web_page_previews?: boolean;
    can_react_to_messages?: boolean;
    can_change_info?: boolean;
    can_invite_users?: boolean;
    can_pin_messages?: boolean;
    can_manage_topics?: boolean;
    can_edit_tag?: boolean;
}

export interface ChatMember {
    status: string;
    user: User;
    until_date?: number;
    can_be_edited?: boolean;
    can_manage_chat?: boolean;
    can_change_info?: boolean;
    can_post_messages?: boolean;
    can_edit_messages?: boolean;
    can_delete_messages?: boolean;
    can_invite_users?: boolean;
    can_restrict_members?: boolean;
    can_pin_messages?: boolean;
    can_manage_topics?: boolean;
    can_promote_members?: boolean;
    can_manage_video_chats?: boolean;
    can_post_stories?: boolean;
    can_edit_stories?: boolean;
    can_delete_stories?: boolean;
    is_anonymous?: boolean;
    custom_title?: string;
    tag?: string;
    can_edit_tag?: boolean;
    can_manage_tags?: boolean;
}

export interface ChatMemberUpdated {
    chat: Chat;
    from: User;
    date: number;
    old_chat_member: ChatMember;
    new_chat_member: ChatMember;
    invite_link?: ChatInviteLink;
    via_join_request?: boolean;
    via_chat_folder_invite_link?: boolean;
}

export interface ChatJoinRequest {
    chat: Chat;
    from: User;
    user_chat_id?: number;
    date: number;
    bio?: string;
    invite_link?: ChatInviteLink;
    query_id?: string;
}

export interface ChatAdministratorRights {
    is_anonymous: boolean;
    can_manage_chat: boolean;
    can_delete_messages: boolean;
    can_manage_video_chats: boolean;
    can_restrict_members: boolean;
    can_promote_members: boolean;
    can_change_info: boolean;
    can_invite_users: boolean;
    can_post_stories?: boolean;
    can_edit_stories?: boolean;
    can_delete_stories?: boolean;
    can_post_messages?: boolean;
    can_edit_messages?: boolean;
    can_pin_messages?: boolean;
    can_manage_topics?: boolean;
    can_manage_tags?: boolean;
    can_manage_direct_messages?: boolean;
    can_send_welcome_messages?: boolean;
}

export interface ChatInviteLink {
    invite_link: string;
    creator: User;
    creates_join_request: boolean;
    is_primary: boolean;
    is_revoked: boolean;
    name?: string;
    expire_date?: number;
    member_limit?: number;
    pending_join_request_count?: number;
}

export interface ForumTopic {
    message_thread_id: number;
    name: string;
    icon_color: number;
    icon_custom_emoji_id?: string;
}

export interface ForumTopicCreated {
    name: string;
    icon_color: number;
    icon_custom_emoji_id?: string;
}

export interface ForumTopicEdited {
    name?: string;
    icon_custom_emoji_id?: string;
}

export interface ForumTopicClosed {
    [key: string]: never;
}

export interface ForumTopicReopened {
    [key: string]: never;
}

export interface GeneralForumTopicHidden {
    [key: string]: never;
}

export interface GeneralForumTopicUnhidden {
    [key: string]: never;
}

export interface BusinessConnection {
    id: string;
    user: User;
    user_chat_id: number;
    date: number;
    can_reply: boolean;
    is_enabled: boolean;
}

export interface InlineQuery {
    id: string;
    from: User;
    query: string;
    offset: string;
    chat_type?: string;
    location?: Location;
}

export interface ChosenInlineResult {
    result_id: string;
    from: User;
    location?: Location;
    inline_message_id?: string;
    query: string;
}

export interface CallbackQuery {
    id: string;
    from: User;
    message?: Message;
    inline_message_id?: string;
    chat_instance: string;
    data?: string;
    game_short_name?: string;
}

export interface ShippingQuery {
    id: string;
    from: User;
    invoice_payload: string;
    shipping_address: any;
}

export interface PreCheckoutQuery {
    id: string;
    from: User;
    currency: string;
    total_amount: number;
    invoice_payload: string;
    shipping_option_id?: string;
    order_info?: any;
}

export interface LabeledPrice {
    label: string;
    amount: number;
}

export interface ShippingOption {
    id: string;
    title: string;
    prices: LabeledPrice[];
}

export interface InlineQueryResult {
    type: string;
    id: string;
    [key: string]: any;
}

export interface ChatBoost {
    boost_id: string;
    add_date: number;
    expiration_date: number;
    source: any;
}

export interface UserChatBoosts {
    boosts: ChatBoost[];
}

export interface ResponseParameters {
    migrate_to_chat_id?: number;
    retry_after?: number;
}

export interface InputMedia {
    type: string;
    media: string;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
}

export interface InputMediaPhoto extends InputMedia {
    type: 'photo';
    has_spoiler?: boolean;
}

export interface InputMediaLivePhoto extends InputMedia {
    type: 'live_photo';
    media: string;
    photo: string;
    show_caption_above_media?: boolean;
    has_spoiler?: boolean;
}

export interface InputMediaVoiceNote {
    type: 'voice_note';
    media: string;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    duration?: number;
}

export interface InputMediaVideo extends InputMedia {
    type: 'video';
    thumbnail?: InputFile | string;
    width?: number;
    height?: number;
    duration?: number;
    supports_streaming?: boolean;
    has_spoiler?: boolean;
}

export interface InputMediaAnimation extends InputMedia {
    type: 'animation';
    thumbnail?: InputFile | string;
    width?: number;
    height?: number;
    duration?: number;
    has_spoiler?: boolean;
}

export interface InputMediaAudio extends InputMedia {
    type: 'audio';
    thumbnail?: InputFile | string;
    duration?: number;
    performer?: string;
    title?: string;
}

export interface InputMediaDocument extends InputMedia {
    type: 'document';
    thumbnail?: InputFile | string;
    disable_content_type_detection?: boolean;
}

export interface InputMediaSticker {
    type: 'sticker';
    media: string;
    emoji?: string;
}

export interface InputMediaLocation {
    type: 'location';
    latitude: number;
    longitude: number;
    horizontal_accuracy?: number;
}

export interface InputMediaVenue {
    type: 'venue';
    latitude: number;
    longitude: number;
    title: string;
    address: string;
    foursquare_id?: string;
    foursquare_type?: string;
    google_place_id?: string;
    google_place_type?: string;
}

export interface InputMediaLink {
    type: 'link';
    url: string;
}

export interface Link {
    url: string;
}

export interface PollMedia {
    animation?: Animation;
    audio?: Audio;
    document?: Document;
    link?: Link;
    live_photo?: LivePhoto;
    location?: Location;
    photo?: PhotoSize[];
    sticker?: Sticker;
    venue?: Venue;
    video?: Video;
}

export type InputPollMedia =
    | InputMediaAnimation
    | InputMediaAudio
    | InputMediaDocument
    | InputMediaLivePhoto
    | InputMediaLocation
    | InputMediaPhoto
    | InputMediaVenue
    | InputMediaVideo;

export type InputPollOptionMedia =
    | InputMediaAnimation
    | InputMediaLink
    | InputMediaLivePhoto
    | InputMediaLocation
    | InputMediaPhoto
    | InputMediaSticker
    | InputMediaVenue
    | InputMediaVideo;

export interface InputPollOption {
    text: string;
    text_parse_mode?: string;
    text_entities?: MessageEntity[];
    media?: InputPollOptionMedia;
}

export interface LivePhoto {
    photo?: PhotoSize[];
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    duration: number;
    mime_type?: string;
    file_size?: number;
}

export interface PaidMediaLivePhoto {
    type: 'live_photo';
    live_photo: LivePhoto;
}

export interface InputPaidMediaLivePhoto {
    type: 'live_photo';
    media: string;
    photo: string;
}

export interface MessageOriginUser {
    type: 'user';
    date: number;
    sender_user: User;
}

export interface MessageOriginHiddenUser {
    type: 'hidden_user';
    date: number;
    sender_user_name: string;
}

export interface MessageOriginChat {
    type: 'chat';
    date: number;
    sender_chat: Chat;
    author_signature?: string;
}

export interface MessageOriginChannel {
    type: 'channel';
    date: number;
    chat: Chat;
    message_id: number;
    author_signature?: string;
}

export type MessageOrigin =
    | MessageOriginUser
    | MessageOriginHiddenUser
    | MessageOriginChat
    | MessageOriginChannel;

export interface ExternalReplyInfo {
    origin?: any;
    chat?: Chat;
    message_id?: number;
    link_preview_options?: any;
    animation?: Animation;
    audio?: Audio;
    document?: Document;
    live_photo?: LivePhoto;
    paid_media?: any;
    photo?: PhotoSize[];
    sticker?: Sticker;
    story?: any;
    video?: Video;
    video_note?: VideoNote;
    voice?: Voice;
    has_media_spoiler?: boolean;
    checklist?: any;
    contact?: Contact;
    dice?: Dice;
    game?: Game;
    giveaway?: any;
    giveaway_winners?: any;
    invoice?: Invoice;
    location?: Location;
    poll?: Poll;
    venue?: Venue;
}

export interface InlineKeyboardMarkup {
    inline_keyboard: InlineKeyboardButton[][];
    force_reply?: boolean;
}

export interface InlineKeyboardButton {
    text: string;
    url?: string;
    callback_data?: string;
    web_app?: any;
    login_url?: any;
    switch_inline_query?: string;
    switch_inline_query_current_chat?: string;
    switch_inline_query_chosen_chat?: any;
    copy_text?: any;
    callback_game?: any;
    pay?: boolean;
    icon_custom_emoji_id?: string;
    disabled?: DisabledButton;
}

export interface DisabledButton {
    [key: string]: never;
}

export interface ReplyKeyboardMarkup {
    keyboard: KeyboardButton[][];
    is_persistent?: boolean;
    resize_keyboard?: boolean;
    one_time_keyboard?: boolean;
    input_field_placeholder?: string;
    selective?: boolean;
    force_reply?: boolean;
}

export interface KeyboardButton {
    text: string;
    request_users?: any;
    request_chat?: any;
    request_contact?: boolean;
    request_location?: boolean;
    request_poll?: any;
    web_app?: any;
    icon_custom_emoji_id?: string;
}

export interface ReplyKeyboardRemove {
    remove_keyboard: true;
    selective?: boolean;
}

export interface ForceReply {
    force_reply: true;
    input_field_placeholder?: string;
    selective?: boolean;
}

export interface ReplyParameters {
    message_id?: number;
    chat_id?: number | string;
    ephemeral_message_id?: number;
    allow_sending_without_reply?: boolean;
    quote?: string;
    quote_parse_mode?: string;
    quote_entities?: MessageEntity[];
    quote_position?: number;
    checklist_task_id?: number;
    poll_option_id?: string;
}

export interface EphemeralMessageParameters {
    receiver_user_id: number;
    callback_query_id?: string;
    replace_callback_query_message?: boolean;
}

export interface SuggestedPostParameters {
    direct_messages_topic_id?: number;
    send_date?: number;
}

export type ReplyMarkupUnion =
    | InlineKeyboardMarkup
    | ReplyKeyboardMarkup
    | ReplyKeyboardRemove
    | ForceReply;

export interface SendMessageParams {
    chat_id: number | string;
    text: string;
    message_thread_id?: number;
    direct_messages_topic_id?: number;
    parse_mode?: string;
    entities?: MessageEntity[];
    link_preview_options?: any;
    disable_notification?: boolean;
    protect_content?: boolean;
    allow_paid_broadcast?: boolean;
    message_effect_id?: string;
    suggested_post_parameters?: SuggestedPostParameters;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
    ephemeral_message_parameters?: EphemeralMessageParameters;
}

export interface SendMessageDraftParams {
    chat_id: number;
    draft_id: number;
    text?: string;
    message_thread_id?: number;
    parse_mode?: string;
    entities?: MessageEntity[];
    disable_notification?: boolean;
    protect_content?: boolean;
    reply_parameters?: ReplyParameters;
    business_connection_id?: string;
    can_stop?: boolean;
    keep_on_stop?: boolean;
}

export interface SendPhotoParams {
    chat_id: number | string;
    photo: InputFile | string;
    message_thread_id?: number;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    show_caption_above_media?: boolean;
    has_spoiler?: boolean;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
    ephemeral_message_parameters?: EphemeralMessageParameters;
    direct_messages_topic_id?: number;
    allow_paid_broadcast?: boolean;
    suggested_post_parameters?: SuggestedPostParameters;
}

export interface SendAudioParams {
    chat_id: number | string;
    audio: InputFile | string;
    message_thread_id?: number;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    duration?: number;
    performer?: string;
    title?: string;
    thumbnail?: InputFile | string;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
    ephemeral_message_parameters?: EphemeralMessageParameters;
    direct_messages_topic_id?: number;
    allow_paid_broadcast?: boolean;
    suggested_post_parameters?: SuggestedPostParameters;
}

export interface SendDocumentParams {
    chat_id: number | string;
    document: InputFile | string;
    message_thread_id?: number;
    thumbnail?: InputFile | string;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    disable_content_type_detection?: boolean;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
    ephemeral_message_parameters?: EphemeralMessageParameters;
    direct_messages_topic_id?: number;
    allow_paid_broadcast?: boolean;
    suggested_post_parameters?: SuggestedPostParameters;
}

export interface SendVideoParams {
    chat_id: number | string;
    video: InputFile | string;
    message_thread_id?: number;
    duration?: number;
    width?: number;
    height?: number;
    thumbnail?: InputFile | string;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    show_caption_above_media?: boolean;
    has_spoiler?: boolean;
    supports_streaming?: boolean;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
    ephemeral_message_parameters?: EphemeralMessageParameters;
    direct_messages_topic_id?: number;
    allow_paid_broadcast?: boolean;
    suggested_post_parameters?: SuggestedPostParameters;
}

export interface SendAnimationParams {
    chat_id: number | string;
    animation: InputFile | string;
    message_thread_id?: number;
    duration?: number;
    width?: number;
    height?: number;
    thumbnail?: InputFile | string;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    show_caption_above_media?: boolean;
    has_spoiler?: boolean;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
    ephemeral_message_parameters?: EphemeralMessageParameters;
    direct_messages_topic_id?: number;
    allow_paid_broadcast?: boolean;
    suggested_post_parameters?: SuggestedPostParameters;
}

export interface SendVoiceParams {
    chat_id: number | string;
    voice: InputFile | string;
    message_thread_id?: number;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    duration?: number;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
    ephemeral_message_parameters?: EphemeralMessageParameters;
    direct_messages_topic_id?: number;
    allow_paid_broadcast?: boolean;
    suggested_post_parameters?: SuggestedPostParameters;
}

export interface SendVideoNoteParams {
    chat_id: number | string;
    video_note: InputFile | string;
    message_thread_id?: number;
    duration?: number;
    length?: number;
    thumbnail?: InputFile | string;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
    ephemeral_message_parameters?: EphemeralMessageParameters;
    direct_messages_topic_id?: number;
    allow_paid_broadcast?: boolean;
    suggested_post_parameters?: SuggestedPostParameters;
}

export interface SendMediaGroupParams {
    chat_id: number | string;
    media: (InputMediaPhoto | InputMediaVideo | InputMediaAnimation | InputMediaAudio | InputMediaDocument | InputMediaLivePhoto)[];
    message_thread_id?: number;
    direct_messages_topic_id?: number;
    disable_notification?: boolean;
    protect_content?: boolean;
    allow_paid_broadcast?: boolean;
    message_effect_id?: string;
    reply_parameters?: ReplyParameters;
    business_connection_id?: string;
}

export interface SendLocationParams {
    chat_id: number | string;
    latitude: number;
    longitude: number;
    message_thread_id?: number;
    horizontal_accuracy?: number;
    live_period?: number;
    heading?: number;
    proximity_alert_radius?: number;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
    ephemeral_message_parameters?: EphemeralMessageParameters;
    direct_messages_topic_id?: number;
    allow_paid_broadcast?: boolean;
    suggested_post_parameters?: SuggestedPostParameters;
}

export interface SendVenueParams {
    chat_id: number | string;
    latitude: number;
    longitude: number;
    title: string;
    address: string;
    message_thread_id?: number;
    foursquare_id?: string;
    foursquare_type?: string;
    google_place_id?: string;
    google_place_type?: string;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
    ephemeral_message_parameters?: EphemeralMessageParameters;
    direct_messages_topic_id?: number;
    allow_paid_broadcast?: boolean;
    suggested_post_parameters?: SuggestedPostParameters;
}

export interface SendContactParams {
    chat_id: number | string;
    phone_number: string;
    first_name: string;
    message_thread_id?: number;
    last_name?: string;
    vcard?: string;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
    ephemeral_message_parameters?: EphemeralMessageParameters;
    direct_messages_topic_id?: number;
    allow_paid_broadcast?: boolean;
    suggested_post_parameters?: SuggestedPostParameters;
}

export interface SendPollParams {
    chat_id: number | string;
    question: string;
    options: (string | InputPollOption)[];
    message_thread_id?: number;
    question_parse_mode?: string;
    question_entities?: MessageEntity[];
    is_anonymous?: boolean;
    type?: 'regular' | 'quiz';
    allows_multiple_answers?: boolean;
    allows_revoting?: boolean;
    shuffle_options?: boolean;
    allow_adding_options?: boolean;
    hide_results_until_closes?: boolean;
    members_only?: boolean;
    country_codes?: string[];
    correct_option_id?: number;
    correct_option_ids?: number[];
    explanation?: string;
    explanation_parse_mode?: string;
    explanation_entities?: MessageEntity[];
    explanation_media?: InputPollMedia;
    open_period?: number;
    close_date?: number;
    is_closed?: boolean;
    description?: string;
    description_parse_mode?: string;
    description_entities?: MessageEntity[];
    media?: InputPollMedia;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
    ephemeral_message_parameters?: EphemeralMessageParameters;
    direct_messages_topic_id?: number;
    allow_paid_broadcast?: boolean;
    suggested_post_parameters?: SuggestedPostParameters;
}

export interface SendDiceParams {
    chat_id: number | string;
    message_thread_id?: number;
    emoji?: string;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
    ephemeral_message_parameters?: EphemeralMessageParameters;
    direct_messages_topic_id?: number;
    allow_paid_broadcast?: boolean;
    suggested_post_parameters?: SuggestedPostParameters;
}

export interface SendChatActionParams {
    chat_id: number | string;
    action: string;
    message_thread_id?: number;
    business_connection_id?: string;
}

export interface SendStickerParams {
    chat_id: number | string;
    sticker: InputFile | string;
    message_thread_id?: number;
    emoji?: string;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
    ephemeral_message_parameters?: EphemeralMessageParameters;
    direct_messages_topic_id?: number;
    allow_paid_broadcast?: boolean;
    suggested_post_parameters?: SuggestedPostParameters;
}

export interface ForwardMessageParams {
    chat_id: number | string;
    from_chat_id: number | string;
    message_id: number;
    message_thread_id?: number;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
}

export interface CopyMessageParams {
    chat_id: number | string;
    from_chat_id: number | string;
    message_id: number;
    message_thread_id?: number;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    show_caption_above_media?: boolean;
    disable_notification?: boolean;
    protect_content?: boolean;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    message_effect_id?: string;
}

export interface EditMessageTextParams {
    chat_id?: number | string;
    message_id?: number;
    inline_message_id?: string;
    text?: string;
    parse_mode?: string;
    entities?: MessageEntity[];
    link_preview_options?: any;
    rich_message?: InputRichMessage;
    reply_markup?: InlineKeyboardMarkup;
    business_connection_id?: string;
}

export interface EditMessageCaptionParams {
    chat_id?: number | string;
    message_id?: number;
    inline_message_id?: string;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    show_caption_above_media?: boolean;
    reply_markup?: InlineKeyboardMarkup;
    business_connection_id?: string;
}

export interface EditMessageMediaParams {
    chat_id?: number | string;
    message_id?: number;
    inline_message_id?: string;
    media: InputMediaPhoto | InputMediaVideo | InputMediaAnimation | InputMediaAudio | InputMediaDocument | InputMediaLivePhoto;
    reply_markup?: InlineKeyboardMarkup;
    business_connection_id?: string;
}

export interface EditMessageReplyMarkupParams {
    chat_id?: number | string;
    message_id?: number;
    inline_message_id?: string;
    reply_markup?: InlineKeyboardMarkup;
    business_connection_id?: string;
}

export interface StopPollParams {
    chat_id: number | string;
    message_id: number;
    reply_markup?: InlineKeyboardMarkup;
    business_connection_id?: string;
}

export interface DeleteMessageParams {
    chat_id: number | string;
    message_id: number;
}

export interface BanChatMemberParams {
    chat_id: number | string;
    user_id: number;
    until_date?: number;
    revoke_messages?: boolean;
}

export interface UnbanChatMemberParams {
    chat_id: number | string;
    user_id: number;
    only_if_banned?: boolean;
}

export interface RestrictChatMemberParams {
    chat_id: number | string;
    user_id: number;
    permissions: ChatPermissions;
    use_independent_chat_permissions?: boolean;
    until_date?: number;
}

export interface PromoteChatMemberParams {
    chat_id: number | string;
    user_id: number;
    is_anonymous?: boolean;
    can_manage_chat?: boolean;
    can_delete_messages?: boolean;
    can_manage_video_chats?: boolean;
    can_restrict_members?: boolean;
    can_promote_members?: boolean;
    can_change_info?: boolean;
    can_invite_users?: boolean;
    can_post_stories?: boolean;
    can_edit_stories?: boolean;
    can_delete_stories?: boolean;
    can_post_messages?: boolean;
    can_edit_messages?: boolean;
    can_pin_messages?: boolean;
    can_manage_topics?: boolean;
    can_manage_tags?: boolean;
    can_manage_direct_messages?: boolean;
    can_send_welcome_messages?: boolean;
}

export interface SetChatAdministratorCustomTitleParams {
    chat_id: number | string;
    user_id: number;
    custom_title: string;
}

export interface SetChatMemberTagParams {
    chat_id: number | string;
    user_id: number;
    tag?: string;
}

export interface BanChatSenderChatParams {
    chat_id: number | string;
    sender_chat_id: number;
}

export interface UnbanChatSenderChatParams {
    chat_id: number | string;
    sender_chat_id: number;
}

export interface SetChatPermissionsParams {
    chat_id: number | string;
    permissions: ChatPermissions;
    use_independent_chat_permissions?: boolean;
}

export interface ExportChatInviteLinkParams {
    chat_id: number | string;
}

export interface CreateChatInviteLinkParams {
    chat_id: number | string;
    name?: string;
    expire_date?: number;
    member_limit?: number;
    creates_join_request?: boolean;
}

export interface EditChatInviteLinkParams {
    chat_id: number | string;
    invite_link: string;
    name?: string;
    expire_date?: number;
    member_limit?: number;
    creates_join_request?: boolean;
}

export interface RevokeChatInviteLinkParams {
    chat_id: number | string;
    invite_link: string;
}

export interface ApproveChatJoinRequestParams {
    chat_id: number | string;
    user_id: number;
}

export interface DeclineChatJoinRequestParams {
    chat_id: number | string;
    user_id: number;
}

export interface SetChatPhotoParams {
    chat_id: number | string;
    photo: InputFile;
}

export interface DeleteChatPhotoParams {
    chat_id: number | string;
}

export interface SetChatTitleParams {
    chat_id: number | string;
    title: string;
}

export interface SetChatDescriptionParams {
    chat_id: number | string;
    description?: string;
}

export interface PinChatMessageParams {
    chat_id: number | string;
    message_id: number;
    disable_notification?: boolean;
    business_connection_id?: string;
}

export interface UnpinChatMessageParams {
    chat_id: number | string;
    message_id?: number;
    business_connection_id?: string;
}

export interface UnpinAllChatMessagesParams {
    chat_id: number | string;
}

export interface LeaveChatParams {
    chat_id: number | string;
}

export interface GetChatParams {
    chat_id: number | string;
}

export interface GetChatAdministratorsParams {
    chat_id: number | string;
    return_bots?: boolean;
}

export interface GetChatMemberCountParams {
    chat_id: number | string;
}

export interface GetChatMemberParams {
    chat_id: number | string;
    user_id: number;
}

export interface SetChatStickerSetParams {
    chat_id: number | string;
    sticker_set_name: string;
}

export interface DeleteChatStickerSetParams {
    chat_id: number | string;
}

export interface GetForumTopicIconStickersParams {
    [key: string]: never;
}

export interface CreateForumTopicParams {
    chat_id: number | string;
    name: string;
    icon_color?: number;
    icon_custom_emoji_id?: string;
}

export interface EditForumTopicParams {
    chat_id: number | string;
    message_thread_id: number;
    name?: string;
    icon_custom_emoji_id?: string;
}

export interface CloseForumTopicParams {
    chat_id: number | string;
    message_thread_id: number;
}

export interface ReopenForumTopicParams {
    chat_id: number | string;
    message_thread_id: number;
}

export interface DeleteForumTopicParams {
    chat_id: number | string;
    message_thread_id: number;
}

export interface UnpinAllForumTopicMessagesParams {
    chat_id: number | string;
    message_thread_id: number;
}

export interface EditGeneralForumTopicParams {
    chat_id: number | string;
    name: string;
}

export interface CloseGeneralForumTopicParams {
    chat_id: number | string;
}

export interface ReopenGeneralForumTopicParams {
    chat_id: number | string;
}

export interface HideGeneralForumTopicParams {
    chat_id: number | string;
}

export interface UnhideGeneralForumTopicParams {
    chat_id: number | string;
}

export interface UnpinAllGeneralForumTopicMessagesParams {
    chat_id: number | string;
}

export interface AnswerCallbackQueryParams {
    callback_query_id: string;
    text?: string;
    show_alert?: boolean;
    url?: string;
    cache_time?: number;
}

export interface GetUserProfilePhotosParams {
    user_id: number;
    offset?: number;
    limit?: number;
}

export interface GetFileParams {
    file_id: string;
}

export interface SetMyCommandsParams {
    commands: BotCommand[];
    scope?: BotCommandScope;
    language_code?: string;
}

export interface DeleteMyCommandsParams {
    scope?: BotCommandScope;
    language_code?: string;
}

export interface GetMyCommandsParams {
    scope?: BotCommandScope;
    language_code?: string;
}

export interface SetMyNameParams {
    name: string;
    language_code?: string;
}

export interface GetMyNameParams {
    language_code?: string;
}

export interface SetMyDescriptionParams {
    description: string;
    language_code?: string;
}

export interface GetMyDescriptionParams {
    language_code?: string;
}

export interface SetMyShortDescriptionParams {
    short_description: string;
    language_code?: string;
}

export interface GetMyShortDescriptionParams {
    language_code?: string;
}

export interface SetChatMenuButtonParams {
    chat_id?: number;
    menu_button?: MenuButton;
}

export interface GetChatMenuButtonParams {
    chat_id?: number;
}

export interface SetMyDefaultAdministratorRightsParams {
    rights?: ChatAdministratorRights;
    for_channels?: boolean;
}

export interface GetMyDefaultAdministratorRightsParams {
    for_channels?: boolean;
}

export interface AnswerInlineQueryParams {
    inline_query_id: string;
    results: InlineQueryResult[];
    cache_time?: number;
    is_personal?: boolean;
    next_offset?: string;
    button?: any;
}

export interface AnswerWebAppQueryParams {
    web_app_query_id: string;
    result: InlineQueryResult;
}

export interface SendInvoiceParams {
    chat_id: number | string;
    title: string;
    description: string;
    payload: string;
    provider_token?: string;
    currency: string;
    prices: LabeledPrice[];
    max_tip_amount?: number;
    suggested_tip_amounts?: number[];
    start_parameter?: string;
    provider_data?: string;
    photo_url?: string;
    photo_size?: number;
    photo_width?: number;
    photo_height?: number;
    need_name?: boolean;
    need_phone_number?: boolean;
    need_email?: boolean;
    need_shipping_address?: boolean;
    send_phone_number_to_provider?: boolean;
    send_email_to_provider?: boolean;
    is_flexible?: boolean;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup;
    business_connection_id?: string;
}

export interface CreateInvoiceLinkParams {
    title: string;
    description: string;
    payload: string;
    provider_token?: string;
    currency: string;
    prices: LabeledPrice[];
    max_tip_amount?: number;
    suggested_tip_amounts?: number[];
    provider_data?: string;
    photo_url?: string;
    photo_size?: number;
    photo_width?: number;
    photo_height?: number;
    need_name?: boolean;
    need_phone_number?: boolean;
    need_email?: boolean;
    need_shipping_address?: boolean;
    send_phone_number_to_provider?: boolean;
    send_email_to_provider?: boolean;
    is_flexible?: boolean;
}

export interface AnswerShippingQueryParams {
    shipping_query_id: string;
    ok: boolean;
    shipping_options?: ShippingOption[];
    error_message?: string;
}

export interface AnswerPreCheckoutQueryParams {
    pre_checkout_query_id: string;
    ok: boolean;
    error_message?: string;
}

export interface GetStarTransactionsParams {
    offset?: number;
    limit?: number;
}

export interface SendGiftParams {
    user_id: number;
    gift_id: string;
    text?: string;
    text_parse_mode?: string;
    text_entities?: MessageEntity[];
    pay?: boolean;
}

export interface SendPaidMediaParams {
    chat_id: number | string;
    star_count: number;
    media: (InputMediaPhoto | InputMediaVideo | InputMediaAnimation | InputMediaAudio | InputMediaDocument | InputPaidMediaLivePhoto)[];
    payload?: string;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    show_caption_above_media?: boolean;
    disable_notification?: boolean;
    protect_content?: boolean;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
}

export interface SetPassportDataErrorsParams {
    user_id: number;
    errors: any[];
}

export interface SendGameParams {
    chat_id: number | string;
    game_short_name: string;
    message_thread_id?: number;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup;
    business_connection_id?: string;
}

export interface SetGameScoreParams {
    user_id: number;
    score: number;
    force?: boolean;
    disable_edit_message?: boolean;
    chat_id?: number;
    message_id?: number;
    inline_message_id?: string;
}

export interface GetGameHighScoresParams {
    user_id: number;
    chat_id?: number;
    message_id?: number;
    inline_message_id?: string;
}

export interface GetBusinessConnectionParams {
    business_connection_id: string;
}

export interface GetUserChatBoostsParams {
    chat_id: number | string;
    user_id: number;
}

export interface SetStickerSetTitleParams {
    name: string;
    title: string;
}

export interface SetStickerSetThumbnailParams {
    name: string;
    user_id: number;
    thumbnail?: InputFile | string;
    format: string;
}

export interface SetCustomEmojiStickerSetThumbnailParams {
    name: string;
    custom_emoji_id: string;
}

export interface DeleteStickerSetParams {
    name: string;
}

export interface GetStickerSetParams {
    name: string;
}

export interface GetCustomEmojiStickersParams {
    custom_emoji_ids: string[];
}

export interface UploadStickerFileParams {
    user_id: number;
    sticker: InputFile;
    sticker_format: 'static' | 'animated' | 'video';
}

export interface CreateNewStickerSetParams {
    user_id: number;
    name: string;
    title: string;
    stickers: any[];
    sticker_format?: 'static' | 'animated' | 'video';
    sticker_type?: 'regular' | 'mask' | 'custom_emoji';
    needs_repainting?: boolean;
}

export interface AddStickerToSetParams {
    user_id: number;
    name: string;
    sticker: any;
}

export interface SetStickerPositionInSetParams {
    sticker: string;
    position: number;
}

export interface DeleteStickerFromSetParams {
    sticker: string;
}

export interface SetStickerEmojiListParams {
    sticker: string;
    emoji_list: string[];
}

export interface SetStickerKeywordsParams {
    sticker: string;
    keywords?: string[];
}

export interface SetStickerMaskPositionParams {
    sticker: string;
    mask_position?: any;
}

export interface LogOutParams {
    [key: string]: never;
}

export interface CloseParams {
    [key: string]: never;
}

export interface BottomButton {
    text: string;
    callback_data?: string;
    url?: string;
    web_app?: any;
    icon_custom_emoji_id?: string;
}


export const BOT_API_VERSION = '10.3';

export interface ChatFullInfo extends Chat {
    max_reaction_count?: number;
    available_reactions?: ReactionType[];
    guard_bot?: User;
    community?: Community;
}

export interface ChatMemberAdministrator {
    status: 'administrator';
    user: User;
    can_be_edited: boolean;
    is_anonymous: boolean;
    can_manage_chat: boolean;
    can_delete_messages: boolean;
    can_manage_video_chats: boolean;
    can_restrict_members: boolean;
    can_promote_members: boolean;
    can_change_info: boolean;
    can_invite_users: boolean;
    can_post_stories?: boolean;
    can_edit_stories?: boolean;
    can_delete_stories?: boolean;
    can_post_messages?: boolean;
    can_edit_messages?: boolean;
    can_pin_messages?: boolean;
    can_manage_topics?: boolean;
    can_manage_tags?: boolean;
    can_manage_direct_messages?: boolean;
    can_send_welcome_messages?: boolean;
    custom_title?: string;
}

export interface ChatMemberRestricted {
    status: 'restricted';
    user: User;
    is_member: boolean;
    can_send_messages: boolean;
    can_send_audios: boolean;
    can_send_documents: boolean;
    can_send_photos: boolean;
    can_send_videos: boolean;
    can_send_video_notes: boolean;
    can_send_voice_notes: boolean;
    can_send_polls: boolean;
    can_send_other_messages: boolean;
    can_add_web_page_previews: boolean;
    can_react_to_messages: boolean;
    can_change_info: boolean;
    can_invite_users: boolean;
    can_pin_messages: boolean;
    can_manage_topics: boolean;
    can_edit_tag?: boolean;
    until_date: number;
}

export interface BusinessMessagesDeleted {
    business_connection_id: string;
    chat: Chat;
    message_ids: number[];
}

export interface ReactionType {
    type: 'emoji' | 'custom_emoji' | 'paid';
    emoji?: string;
    custom_emoji_id?: string;
}

export interface MessageReactionUpdated {
    chat: Chat;
    message_id: number;
    user?: User;
    actor_chat?: Chat;
    date: number;
    old_reaction: ReactionType[];
    new_reaction: ReactionType[];
}

export interface MessageReactionCountUpdated {
    chat: Chat;
    message_id: number;
    date: number;
    reactions: { type: ReactionType; total_count: number }[];
}

export interface ChatBoostUpdated {
    chat: Chat;
    boost: ChatBoost;
}

export interface ChatBoostRemoved {
    chat: Chat;
    boost_id: string;
    remove_date: number;
    source: any;
}

export interface ManagedBotUpdated {
    user: User;
    token?: string;
    owner?: User;
}

export interface PaidMediaPurchased {
    from: User;
    paid_media_payload: string;
}

export interface Community {
    id: number;
    name: string;
}

export interface CommunityChatAdded {
    community: Community;
}

export interface CommunityChatJoined {
    community: Community;
}

export interface CommunityChatRemoved {
    [key: string]: never;
}

export interface BotSubscriptionUpdated {
    user: User;
    invoice_payload: string;
    state: 'canceled' | 'active' | 'failed';
}

export interface MessageGenerationStopped {
    chat: Chat;
    message_thread_id?: number;
    draft_id: number;
}

export interface SentGuestMessage {
    inline_message_id: string;
}

export interface BotAccessSettings {
    is_access_restricted: boolean;
    added_users?: User[];
}

export interface UniqueGift {
    gift_id?: string;
    name?: string;
    [key: string]: any;
}

export interface UniqueGiftInfo {
    gift: UniqueGift;
    origin: string;
    text?: string;
    entities?: MessageEntity[];
    is_private?: boolean;
    last_resale_currency?: string;
    last_resale_amount?: number;
    owned_gift_id?: string;
    transfer_star_count?: number;
    next_transfer_date?: number;
}

export interface UserProfileAudios {
    total_count: number;
    audios: Audio[];
}


export type RichText =
    | string
    | RichText[]
    | RichTextBold
    | RichTextItalic
    | RichTextUnderline
    | RichTextStrikethrough
    | RichTextSpoiler
    | RichTextDateTime
    | RichTextTextMention
    | RichTextSubscript
    | RichTextSuperscript
    | RichTextMarked
    | RichTextCode
    | RichTextCustomEmoji
    | RichTextMathematicalExpression
    | RichTextUrl
    | RichTextEmailAddress
    | RichTextPhoneNumber
    | RichTextBankCardNumber
    | RichTextMention
    | RichTextHashtag
    | RichTextCashtag
    | RichTextBotCommand
    | RichTextButton
    | RichTextAnchor
    | RichTextAnchorLink
    | RichTextReference
    | RichTextReferenceLink;

export interface RichTextBold { type: 'bold'; text: RichText; }
export interface RichTextItalic { type: 'italic'; text: RichText; }
export interface RichTextUnderline { type: 'underline'; text: RichText; }
export interface RichTextStrikethrough { type: 'strikethrough'; text: RichText; }
export interface RichTextSpoiler { type: 'spoiler'; text: RichText; }
export interface RichTextDateTime { type: 'date_time'; text: RichText; unix_time: number; date_time_format: string; }
export interface RichTextTextMention { type: 'text_mention'; text: RichText; user: User; }
export interface RichTextSubscript { type: 'subscript'; text: RichText; }
export interface RichTextSuperscript { type: 'superscript'; text: RichText; }
export interface RichTextMarked { type: 'marked'; text: RichText; }
export interface RichTextCode { type: 'code'; text: RichText; }
export interface RichTextCustomEmoji { type: 'custom_emoji'; custom_emoji_id: string; alternative_text: string; }
export interface RichTextMathematicalExpression { type: 'mathematical_expression'; expression: string; }
export interface RichTextUrl { type: 'url'; text: RichText; url: string; }
export interface RichTextEmailAddress { type: 'email_address'; text: RichText; email_address: string; }
export interface RichTextPhoneNumber { type: 'phone_number'; text: RichText; phone_number: string; }
export interface RichTextBankCardNumber { type: 'bank_card_number'; text: RichText; bank_card_number: string; }
export interface RichTextMention { type: 'mention'; text: RichText; username: string; }
export interface RichTextHashtag { type: 'hashtag'; text: RichText; hashtag: string; }
export interface RichTextCashtag { type: 'cashtag'; text: RichText; cashtag: string; }
export interface RichTextBotCommand { type: 'bot_command'; text: RichText; bot_command: string; }
export interface RichTextButton { type: 'button'; button: RichMessageButton; }
export interface RichTextAnchor { type: 'anchor'; name: string; }
export interface RichTextAnchorLink { type: 'anchor_link'; text: RichText; anchor_name: string; }
export interface RichTextReference { type: 'reference'; text: RichText; name: string; }
export interface RichTextReferenceLink { type: 'reference_link'; text: RichText; reference_name: string; }

export interface RichMessageButton {
    text: RichText;
    style?: 'danger' | 'success' | 'primary' | 'link';
    url?: string;
    callback_data?: string;
    web_app?: any;
    login_url?: any;
    switch_inline_query?: string;
    switch_inline_query_current_chat?: string;
    switch_inline_query_chosen_chat?: any;
    copy_text?: any;
    callback_game?: any;
    pay?: boolean;
    disabled?: DisabledButton;
}

export interface RichBlockCaption {
    text: RichText;
    credit?: RichText;
}

export interface RichBlockTableCell {
    text?: RichText;
    is_header?: boolean;
    colspan?: number;
    rowspan?: number;
    align?: 'left' | 'center' | 'right';
    valign?: 'top' | 'middle' | 'bottom';
}

export interface RichBlockListItem {
    label: string;
    blocks: RichBlock[];
    has_checkbox?: boolean;
    is_checked?: boolean;
    value?: number;
    type?: string;
}

export type RichBlock =
    | RichBlockParagraph
    | RichBlockSectionHeading
    | RichBlockPreformatted
    | RichBlockFooter
    | RichBlockDivider
    | RichBlockMathematicalExpression
    | RichBlockAnchor
    | RichBlockList
    | RichBlockBlockQuotation
    | RichBlockExpandableBlockQuotation
    | RichBlockPullQuotation
    | RichBlockCollage
    | RichBlockSlideshow
    | RichBlockTable
    | RichBlockDetails
    | RichBlockMap
    | RichBlockButtons
    | RichBlockAnimation
    | RichBlockAudio
    | RichBlockPhoto
    | RichBlockVideo
    | RichBlockVoiceNote
    | RichBlockDocument
    | RichBlockThinking;

export interface RichBlockParagraph { type: 'paragraph'; text: RichText; }
export interface RichBlockSectionHeading { type: 'heading'; text: RichText; size: number; }
export interface RichBlockPreformatted { type: 'pre'; text: RichText; language?: string; }
export interface RichBlockFooter { type: 'footer'; text: RichText; }
export interface RichBlockDivider { type: 'divider'; }
export interface RichBlockMathematicalExpression { type: 'mathematical_expression'; expression: string; }
export interface RichBlockAnchor { type: 'anchor'; name: string; }
export interface RichBlockList { type: 'list'; items: RichBlockListItem[]; }
export interface RichBlockBlockQuotation { type: 'blockquote'; blocks: RichBlock[]; credit?: RichText; }
export interface RichBlockExpandableBlockQuotation { type: 'expandable_blockquote'; text: RichText; credit?: RichText; }
export interface RichBlockPullQuotation { type: 'pullquote'; text: RichText; credit?: RichText; }
export interface RichBlockCollage { type: 'collage'; blocks: RichBlock[]; caption?: RichBlockCaption; }
export interface RichBlockSlideshow { type: 'slideshow'; blocks: RichBlock[]; caption?: RichBlockCaption; }
export interface RichBlockTable {
    type: 'table';
    cells: RichBlockTableCell[][];
    is_bordered?: boolean;
    is_striped?: boolean;
    is_compact?: boolean;
    caption?: RichText;
}
export interface RichBlockDetails { type: 'details'; summary: RichText; blocks: RichBlock[]; is_open?: boolean; }
export interface RichBlockMap {
    type: 'map';
    location: Location;
    zoom?: number;
    width?: number;
    height?: number;
    caption?: RichBlockCaption;
}
export interface RichBlockButtons { type: 'buttons'; buttons: RichMessageButton[]; align?: 'left' | 'center' | 'right'; }
export interface RichBlockAnimation { type: 'animation'; animation: Animation; has_spoiler?: boolean; caption?: RichBlockCaption; }
export interface RichBlockAudio { type: 'audio'; audio: Audio; caption?: RichBlockCaption; }
export interface RichBlockPhoto { type: 'photo'; photo: PhotoSize[]; has_spoiler?: boolean; caption?: RichBlockCaption; }
export interface RichBlockVideo { type: 'video'; video: Video; has_spoiler?: boolean; caption?: RichBlockCaption; }
export interface RichBlockVoiceNote { type: 'voice_note'; voice_note: Voice; caption?: RichBlockCaption; }
export interface RichBlockDocument { type: 'document'; document: Document; caption?: RichBlockCaption; }
export interface RichBlockThinking { type: 'thinking'; text: RichText; }

export interface RichMessage {
    blocks: RichBlock[];
    is_rtl?: boolean;
}

export interface InputRichMessageMedia {
    id: string;
    media: InputMediaAnimation | InputMediaAudio | InputMediaDocument | InputMediaPhoto | InputMediaVideo | InputMediaVoiceNote;
}

export interface InputRichMessage {
    blocks?: InputRichBlock[];
    html?: string;
    markdown?: string;
    media?: InputRichMessageMedia[];
    is_rtl?: boolean;
    skip_entity_detection?: boolean;
}

export interface InputRichMessageContent {
    rich_message: InputRichMessage;
}

export interface InputRichBlockListItem {
    blocks: InputRichBlock[];
    has_checkbox?: boolean;
    is_checked?: boolean;
    value?: number;
}

export type InputRichBlock =
    | InputRichBlockParagraph
    | InputRichBlockSectionHeading
    | InputRichBlockPreformatted
    | InputRichBlockFooter
    | InputRichBlockDivider
    | InputRichBlockMathematicalExpression
    | InputRichBlockAnchor
    | InputRichBlockList
    | InputRichBlockBlockQuotation
    | InputRichBlockExpandableBlockQuotation
    | InputRichBlockPullQuotation
    | InputRichBlockCollage
    | InputRichBlockSlideshow
    | InputRichBlockTable
    | InputRichBlockDetails
    | InputRichBlockMap
    | InputRichBlockButtons
    | InputRichBlockAnimation
    | InputRichBlockAudio
    | InputRichBlockPhoto
    | InputRichBlockVideo
    | InputRichBlockVoiceNote
    | InputRichBlockDocument
    | InputRichBlockThinking;

export interface InputRichBlockParagraph { type: 'paragraph'; text: RichText; }
export interface InputRichBlockSectionHeading { type: 'heading'; text: RichText; size: number; }
export interface InputRichBlockPreformatted { type: 'pre'; text: RichText; language?: string; }
export interface InputRichBlockFooter { type: 'footer'; text: RichText; }
export interface InputRichBlockDivider { type: 'divider'; }
export interface InputRichBlockMathematicalExpression { type: 'mathematical_expression'; expression: string; }
export interface InputRichBlockAnchor { type: 'anchor'; name: string; }
export interface InputRichBlockList { type: 'list'; items: InputRichBlockListItem[]; }
export interface InputRichBlockBlockQuotation { type: 'blockquote'; blocks: InputRichBlock[]; credit?: RichText; }
export interface InputRichBlockExpandableBlockQuotation { type: 'expandable_blockquote'; text: RichText; credit?: RichText; }
export interface InputRichBlockPullQuotation { type: 'pullquote'; text: RichText; credit?: RichText; }
export interface InputRichBlockCollage { type: 'collage'; blocks: InputRichBlock[]; caption?: RichBlockCaption; }
export interface InputRichBlockSlideshow { type: 'slideshow'; blocks: InputRichBlock[]; caption?: RichBlockCaption; }
export interface InputRichBlockTable {
    type: 'table';
    cells: RichBlockTableCell[][];
    is_bordered?: boolean;
    is_striped?: boolean;
    is_compact?: boolean;
    caption?: RichText;
}
export interface InputRichBlockDetails { type: 'details'; summary: RichText; blocks: InputRichBlock[]; is_open?: boolean; }
export interface InputRichBlockMap {
    type: 'map';
    location: Location;
    zoom?: number;
    width?: number;
    height?: number;
    caption?: RichBlockCaption;
}
export interface InputRichBlockButtons { type: 'buttons'; buttons: RichMessageButton[]; align?: 'left' | 'center' | 'right'; }
export interface InputRichBlockAnimation { type: 'animation'; animation: InputMediaAnimation; caption?: RichBlockCaption; }
export interface InputRichBlockAudio { type: 'audio'; audio: InputMediaAudio; caption?: RichBlockCaption; }
export interface InputRichBlockPhoto { type: 'photo'; photo: InputMediaPhoto; caption?: RichBlockCaption; }
export interface InputRichBlockVideo { type: 'video'; video: InputMediaVideo; caption?: RichBlockCaption; }
export interface InputRichBlockVoiceNote { type: 'voice_note'; voice_note: InputMediaVoiceNote; caption?: RichBlockCaption; }
export interface InputRichBlockDocument { type: 'document'; document: InputMediaDocument; caption?: RichBlockCaption; }
export interface InputRichBlockThinking { type: 'thinking'; text: RichText; }

export interface InputChecklist {
    title: string;
    title_entities?: MessageEntity[];
    tasks: any[];
    others_can_add_tasks?: boolean;
    others_can_mark_tasks_as_done?: boolean;
}


export interface AnswerGuestQueryParams {
    guest_query_id: string;
    result: InlineQueryResult;
}

export interface AnswerChatJoinRequestQueryParams {
    chat_join_request_query_id: string;
    result: 'approve' | 'decline' | 'queue';
}

export interface SendChatJoinRequestWebAppParams {
    chat_join_request_query_id: string;
    web_app_url: string;
}

export interface SendLivePhotoParams {
    chat_id: number | string;
    live_photo: InputFile | string;
    photo: InputFile | string;
    message_thread_id?: number;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    show_caption_above_media?: boolean;
    has_spoiler?: boolean;
    disable_notification?: boolean;
    protect_content?: boolean;
    allow_paid_broadcast?: boolean;
    message_effect_id?: string;
    suggested_post_parameters?: SuggestedPostParameters;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
    ephemeral_message_parameters?: EphemeralMessageParameters;
    direct_messages_topic_id?: number;
}

export interface SendRichMessageParams {
    chat_id: number | string;
    rich_message: InputRichMessage;
    message_thread_id?: number;
    direct_messages_topic_id?: number;
    disable_notification?: boolean;
    protect_content?: boolean;
    allow_paid_broadcast?: boolean;
    message_effect_id?: string;
    suggested_post_parameters?: SuggestedPostParameters;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
    ephemeral_message_parameters?: EphemeralMessageParameters;
}

export interface SendRichMessageDraftParams {
    chat_id: number;
    draft_id: number;
    message_thread_id?: number;
    rich_message: InputRichMessage;
    can_stop?: boolean;
    keep_on_stop?: boolean;
}

export interface EditEphemeralMessageTextParams {
    chat_id: number | string;
    receiver_user_id: number;
    ephemeral_message_id: number;
    text?: string;
    parse_mode?: string;
    entities?: MessageEntity[];
    rich_message?: InputRichMessage;
    link_preview_options?: any;
    reply_markup?: InlineKeyboardMarkup;
}

export interface EditEphemeralMessageMediaParams {
    chat_id: number | string;
    receiver_user_id: number;
    ephemeral_message_id: number;
    media: InputMedia | InputMediaPhoto | InputMediaVideo | InputMediaAnimation | InputMediaAudio | InputMediaDocument | InputMediaLivePhoto;
    reply_markup?: InlineKeyboardMarkup;
}

export interface EditEphemeralMessageCaptionParams {
    chat_id: number | string;
    receiver_user_id: number;
    ephemeral_message_id: number;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    show_caption_above_media?: boolean;
    reply_markup?: InlineKeyboardMarkup;
}

export interface EditEphemeralMessageReplyMarkupParams {
    chat_id: number | string;
    receiver_user_id: number;
    ephemeral_message_id: number;
    reply_markup?: InlineKeyboardMarkup;
}

export interface DeleteEphemeralMessageParams {
    chat_id: number | string;
    receiver_user_id: number;
    ephemeral_message_id: number;
}

export interface GetUserPersonalChatMessagesParams {
    user_id: number;
    limit: number;
}

export interface GetManagedBotAccessSettingsParams {
    user_id: number;
}

export interface SetManagedBotAccessSettingsParams {
    user_id: number;
    is_access_restricted: boolean;
    added_user_ids?: number[];
}

export interface GetManagedBotTokenParams {
    user_id: number;
}

export interface ReplaceManagedBotTokenParams {
    user_id: number;
}

export interface DeleteMessageReactionParams {
    chat_id: number | string;
    message_id: number;
    user_id?: number;
    actor_chat_id?: number;
}

export interface DeleteAllMessageReactionsParams {
    chat_id: number | string;
    user_id?: number;
    actor_chat_id?: number;
}

export interface SetMessageReactionParams {
    chat_id: number | string;
    message_id: number;
    reaction?: ReactionType[];
    is_big?: boolean;
}

export interface CopyMessagesParams {
    chat_id: number | string;
    from_chat_id: number | string;
    message_ids: number[];
    message_thread_id?: number;
    direct_messages_topic_id?: number;
    disable_notification?: boolean;
    protect_content?: boolean;
    remove_caption?: boolean;
}

export interface ForwardMessagesParams {
    chat_id: number | string;
    from_chat_id: number | string;
    message_ids: number[];
    message_thread_id?: number;
    direct_messages_topic_id?: number;
    disable_notification?: boolean;
    protect_content?: boolean;
}

export interface DeleteMessagesParams {
    chat_id: number | string;
    message_ids: number[];
}

export interface EditMessageLiveLocationParams {
    chat_id?: number | string;
    message_id?: number;
    inline_message_id?: string;
    latitude: number;
    longitude: number;
    live_period?: number;
    horizontal_accuracy?: number;
    heading?: number;
    proximity_alert_radius?: number;
    reply_markup?: InlineKeyboardMarkup;
    business_connection_id?: string;
}

export interface StopMessageLiveLocationParams {
    chat_id?: number | string;
    message_id?: number;
    inline_message_id?: string;
    reply_markup?: InlineKeyboardMarkup;
    business_connection_id?: string;
}

export interface EditMessageChecklistParams {
    business_connection_id: string;
    chat_id: number | string;
    message_id: number;
    checklist: InputChecklist;
    reply_markup?: InlineKeyboardMarkup;
}

export interface SendChecklistParams {
    business_connection_id: string;
    chat_id: number | string;
    checklist: InputChecklist;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: ReplyParameters;
    reply_markup?: InlineKeyboardMarkup;
}

export interface CreateChatSubscriptionInviteLinkParams {
    chat_id: number | string;
    subscription_period: number;
    subscription_price: number;
    name?: string;
}

export interface EditChatSubscriptionInviteLinkParams {
    chat_id: number | string;
    invite_link: string;
    name?: string;
}

export interface GetUserProfileAudiosParams {
    user_id: number;
    offset?: number;
    limit?: number;
}

export interface ApproveSuggestedPostParams {
    chat_id: number;
    message_id: number;
    send_date?: number;
}

export interface DeclineSuggestedPostParams {
    chat_id: number;
    message_id: number;
    comment?: string;
}

export interface ReplaceStickerInSetParams {
    user_id: number;
    name: string;
    old_sticker: string;
    sticker: any;
}
