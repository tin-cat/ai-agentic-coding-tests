<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Infrastructure\Http;

use Frontstage\Catalog\Domain\Exception\EventNotFound;
use Frontstage\Catalog\Domain\Exception\InvalidArgument;
use Frontstage\Catalog\Domain\Exception\InvalidEventState;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\Messenger\Exception\HandlerFailedException;

/**
 * Translates domain exceptions thrown anywhere inside a request into JSON
 * error responses. Without this, callers would see Symfony's default HTML
 * error pages and our API contract would leak.
 */
#[AsEventListener]
final class CatalogExceptionListener
{
	public function __invoke(ExceptionEvent $event): void
	{
		$throwable = $event->getThrowable();

		// Messenger wraps handler exceptions in HandlerFailedException; unwrap
		// to find the original domain error.
		if ($throwable instanceof HandlerFailedException) {
			$nested = $throwable->getPrevious();
			if (null !== $nested) {
				$throwable = $nested;
			}
		}

		$response = match (true) {
			$throwable instanceof EventNotFound => $this->error(Response::HTTP_NOT_FOUND, $throwable->getMessage()),
			$throwable instanceof InvalidArgument => $this->error(Response::HTTP_BAD_REQUEST, $throwable->getMessage()),
			$throwable instanceof InvalidEventState => $this->error(Response::HTTP_CONFLICT, $throwable->getMessage()),
			default => null,
		};

		if (null !== $response) {
			$event->setResponse($response);
		}
	}

	private function error(int $status, string $message): JsonResponse
	{
		return new JsonResponse(['error' => $message], $status);
	}}
