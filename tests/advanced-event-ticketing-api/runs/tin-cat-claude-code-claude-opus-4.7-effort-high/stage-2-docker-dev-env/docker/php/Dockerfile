# Frontstage backend image: PHP-FPM with the extensions the Symfony app needs,
# Composer dependencies baked in, and the project source ready to be overlaid
# by a host bind mount in development.
FROM php:8.3-fpm-alpine

ENV COMPOSER_ALLOW_SUPERUSER=1 \
	COMPOSER_NO_INTERACTION=1

# System packages needed to build the PHP extensions (rabbitmq-c, libpq, icu, libzip)
# and to run Composer (git, unzip, bash for entrypoint scripts).
RUN apk add --no-cache \
		bash \
		git \
		unzip \
		icu-dev \
		libzip-dev \
		libpq-dev \
		rabbitmq-c-dev \
		linux-headers \
		$PHPIZE_DEPS \
	&& docker-php-ext-install -j"$(nproc)" \
		intl \
		opcache \
		pdo \
		pdo_pgsql \
		zip \
		sockets \
	&& pecl install redis amqp \
	&& docker-php-ext-enable redis amqp \
	&& apk del --no-network $PHPIZE_DEPS \
	&& rm -rf /tmp/pear /var/cache/apk/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

# Install Composer dependencies first so layer caching kicks in on source-only edits.
COPY composer.json composer.lock symfony.lock ./
RUN composer install \
		--no-scripts \
		--no-autoloader \
		--prefer-dist

# Bring in the rest of the source and finalize the autoloader.
COPY . .
RUN composer dump-autoload --optimize --no-scripts \
	&& mkdir -p var \
	&& chmod -R 0777 var

# PHP and FPM tuning lives next to the Dockerfile so the image is self-contained.
COPY docker/php/php.ini /usr/local/etc/php/conf.d/zz-frontstage.ini
COPY docker/php/www.conf /usr/local/etc/php-fpm.d/zz-frontstage.conf

EXPOSE 9000

CMD ["php-fpm"]
