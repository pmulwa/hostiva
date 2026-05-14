-- ===========================================
-- HOSTLY.COM DATABASE SCHEMA
-- A comprehensive hosting platform
-- ===========================================

-- Create enum types
CREATE TYPE public.app_role AS ENUM ('admin', 'host', 'guest');
CREATE TYPE public.property_status AS ENUM ('draft', 'pending_approval', 'active', 'inactive', 'rejected');
CREATE TYPE public.booking_status AS ENUM ('pending', 'confirmed', 'cancelled', 'completed', 'rejected');
CREATE TYPE public.property_type AS ENUM ('apartment', 'house', 'villa', 'cabin', 'cottage', 'loft', 'studio', 'penthouse', 'resort', 'hotel');

-- ===========================================
-- PROFILES TABLE
-- ===========================================
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    phone TEXT,
    bio TEXT,
    location TEXT,
    is_host BOOLEAN DEFAULT false,
    is_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view profiles" ON public.profiles
    FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ===========================================
-- USER ROLES TABLE (for admin/host/guest)
-- ===========================================
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role app_role NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = _user_id
          AND role = _role
    )
$$;

CREATE POLICY "Users can view own roles" ON public.user_roles
    FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage roles" ON public.user_roles
    FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- ===========================================
-- PROPERTIES TABLE
-- ===========================================
CREATE TABLE public.properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    property_type property_type NOT NULL DEFAULT 'apartment',
    status property_status NOT NULL DEFAULT 'draft',
    
    -- Location
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT,
    country TEXT NOT NULL,
    postal_code TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    
    -- Pricing
    price_per_night DECIMAL(10, 2) NOT NULL,
    cleaning_fee DECIMAL(10, 2) DEFAULT 0,
    service_fee_percent DECIMAL(5, 2) DEFAULT 10,
    currency TEXT DEFAULT 'USD',
    
    -- Capacity
    max_guests INTEGER NOT NULL DEFAULT 2,
    bedrooms INTEGER NOT NULL DEFAULT 1,
    beds INTEGER NOT NULL DEFAULT 1,
    bathrooms DECIMAL(3, 1) NOT NULL DEFAULT 1,
    
    -- Rules
    check_in_time TIME DEFAULT '15:00',
    check_out_time TIME DEFAULT '11:00',
    min_nights INTEGER DEFAULT 1,
    max_nights INTEGER DEFAULT 365,
    instant_booking BOOLEAN DEFAULT false,
    
    -- Media
    cover_image TEXT,
    images TEXT[] DEFAULT ARRAY[]::TEXT[],
    
    -- Stats
    average_rating DECIMAL(3, 2) DEFAULT 0,
    total_reviews INTEGER DEFAULT 0,
    total_bookings INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active properties" ON public.properties
    FOR SELECT USING (status = 'active' OR auth.uid() = host_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Hosts can create properties" ON public.properties
    FOR INSERT WITH CHECK (auth.uid() = host_id);

CREATE POLICY "Hosts can update own properties" ON public.properties
    FOR UPDATE USING (auth.uid() = host_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Hosts can delete own properties" ON public.properties
    FOR DELETE USING (auth.uid() = host_id OR public.has_role(auth.uid(), 'admin'));

-- ===========================================
-- AMENITIES TABLE
-- ===========================================
CREATE TABLE public.amenities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    icon TEXT,
    category TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

ALTER TABLE public.amenities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view amenities" ON public.amenities
    FOR SELECT USING (true);

CREATE POLICY "Admins can manage amenities" ON public.amenities
    FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Property-Amenities junction table
CREATE TABLE public.property_amenities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    amenity_id UUID NOT NULL REFERENCES public.amenities(id) ON DELETE CASCADE,
    UNIQUE (property_id, amenity_id)
);

ALTER TABLE public.property_amenities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view property amenities" ON public.property_amenities
    FOR SELECT USING (true);

CREATE POLICY "Property owners can manage amenities" ON public.property_amenities
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.properties WHERE id = property_id AND host_id = auth.uid())
        OR public.has_role(auth.uid(), 'admin')
    );

-- ===========================================
-- BOOKINGS TABLE
-- ===========================================
CREATE TABLE public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    guest_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    status booking_status NOT NULL DEFAULT 'pending',
    
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    
    num_guests INTEGER NOT NULL DEFAULT 1,
    
    -- Pricing breakdown
    nightly_rate DECIMAL(10, 2) NOT NULL,
    num_nights INTEGER NOT NULL,
    subtotal DECIMAL(10, 2) NOT NULL,
    cleaning_fee DECIMAL(10, 2) DEFAULT 0,
    service_fee DECIMAL(10, 2) DEFAULT 0,
    total_price DECIMAL(10, 2) NOT NULL,
    currency TEXT DEFAULT 'USD',
    
    -- Messages
    guest_message TEXT,
    host_response TEXT,
    cancellation_reason TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    
    CONSTRAINT valid_dates CHECK (check_out_date > check_in_date)
);

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Guests can view own bookings" ON public.bookings
    FOR SELECT USING (auth.uid() = guest_id OR auth.uid() = host_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Guests can create bookings" ON public.bookings
    FOR INSERT WITH CHECK (auth.uid() = guest_id);

CREATE POLICY "Guests and hosts can update bookings" ON public.bookings
    FOR UPDATE USING (auth.uid() = guest_id OR auth.uid() = host_id OR public.has_role(auth.uid(), 'admin'));

-- ===========================================
-- REVIEWS TABLE
-- ===========================================
CREATE TABLE public.reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE UNIQUE,
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    guest_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Ratings (1-5)
    overall_rating INTEGER NOT NULL CHECK (overall_rating >= 1 AND overall_rating <= 5),
    cleanliness_rating INTEGER CHECK (cleanliness_rating >= 1 AND cleanliness_rating <= 5),
    communication_rating INTEGER CHECK (communication_rating >= 1 AND communication_rating <= 5),
    checkin_rating INTEGER CHECK (checkin_rating >= 1 AND checkin_rating <= 5),
    accuracy_rating INTEGER CHECK (accuracy_rating >= 1 AND accuracy_rating <= 5),
    location_rating INTEGER CHECK (location_rating >= 1 AND location_rating <= 5),
    value_rating INTEGER CHECK (value_rating >= 1 AND value_rating <= 5),
    
    comment TEXT,
    host_response TEXT,
    
    is_public BOOLEAN DEFAULT true,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view public reviews" ON public.reviews
    FOR SELECT USING (is_public = true OR auth.uid() = guest_id OR auth.uid() = host_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Guests can create reviews for their bookings" ON public.reviews
    FOR INSERT WITH CHECK (auth.uid() = guest_id);

CREATE POLICY "Guests can update own reviews" ON public.reviews
    FOR UPDATE USING (auth.uid() = guest_id);

-- ===========================================
-- FAVORITES TABLE
-- ===========================================
CREATE TABLE public.favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    UNIQUE (user_id, property_id)
);

ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own favorites" ON public.favorites
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own favorites" ON public.favorites
    FOR ALL USING (auth.uid() = user_id);

-- ===========================================
-- MESSAGES TABLE
-- ===========================================
CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own messages" ON public.messages
    FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

CREATE POLICY "Users can send messages" ON public.messages
    FOR INSERT WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Users can update own messages" ON public.messages
    FOR UPDATE USING (auth.uid() = receiver_id);

-- ===========================================
-- PROPERTY AVAILABILITY TABLE
-- ===========================================
CREATE TABLE public.property_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    is_available BOOLEAN DEFAULT true,
    custom_price DECIMAL(10, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    UNIQUE (property_id, date)
);

ALTER TABLE public.property_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view availability" ON public.property_availability
    FOR SELECT USING (true);

CREATE POLICY "Hosts can manage own property availability" ON public.property_availability
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.properties WHERE id = property_id AND host_id = auth.uid())
        OR public.has_role(auth.uid(), 'admin')
    );

-- ===========================================
-- TRIGGERS FOR UPDATED_AT
-- ===========================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_properties_updated_at
    BEFORE UPDATE ON public.properties
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_bookings_updated_at
    BEFORE UPDATE ON public.bookings
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_reviews_updated_at
    BEFORE UPDATE ON public.reviews
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===========================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- ===========================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (user_id, email, full_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', '')
    );
    
    -- Give everyone guest role by default
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'guest');
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===========================================
-- UPDATE PROPERTY STATS AFTER REVIEW
-- ===========================================
CREATE OR REPLACE FUNCTION public.update_property_stats()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.properties
    SET 
        average_rating = (
            SELECT COALESCE(AVG(overall_rating), 0)
            FROM public.reviews
            WHERE property_id = NEW.property_id AND is_public = true
        ),
        total_reviews = (
            SELECT COUNT(*)
            FROM public.reviews
            WHERE property_id = NEW.property_id AND is_public = true
        )
    WHERE id = NEW.property_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER update_property_stats_on_review
    AFTER INSERT OR UPDATE OR DELETE ON public.reviews
    FOR EACH ROW EXECUTE FUNCTION public.update_property_stats();

-- ===========================================
-- INSERT DEFAULT AMENITIES
-- ===========================================
INSERT INTO public.amenities (name, icon, category) VALUES
    ('WiFi', 'wifi', 'essentials'),
    ('Air Conditioning', 'wind', 'essentials'),
    ('Heating', 'thermometer', 'essentials'),
    ('Kitchen', 'utensils', 'essentials'),
    ('Washer', 'shirt', 'essentials'),
    ('Dryer', 'fan', 'essentials'),
    ('TV', 'tv', 'entertainment'),
    ('Pool', 'waves', 'outdoor'),
    ('Hot Tub', 'bath', 'outdoor'),
    ('Gym', 'dumbbell', 'fitness'),
    ('Free Parking', 'car', 'parking'),
    ('EV Charger', 'plug', 'parking'),
    ('Fireplace', 'flame', 'indoor'),
    ('BBQ Grill', 'flame', 'outdoor'),
    ('Balcony', 'mountain', 'outdoor'),
    ('Garden', 'flower', 'outdoor'),
    ('Beach Access', 'umbrella', 'outdoor'),
    ('Ski-in/Ski-out', 'snowflake', 'outdoor'),
    ('Workspace', 'briefcase', 'work'),
    ('Pet Friendly', 'dog', 'policies');