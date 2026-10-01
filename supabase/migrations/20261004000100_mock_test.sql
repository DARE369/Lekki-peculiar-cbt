-- Mocks come in two kinds, like the real thing: an exam mock ('mock') and a test mock.
alter type public.assessment_type add value if not exists 'mock_test';
