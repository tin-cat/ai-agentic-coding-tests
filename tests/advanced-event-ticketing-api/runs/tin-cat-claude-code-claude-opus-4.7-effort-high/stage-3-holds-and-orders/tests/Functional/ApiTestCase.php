<?php

declare(strict_types=1);

namespace Frontstage\Tests\Functional;

use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\Tools\SchemaTool;
use Psr\Cache\CacheItemPoolInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\HttpFoundation\Response;

/**
 * Base class for functional tests that drive the HTTP API end-to-end.
 *
 * Boots the test kernel, rebuilds the schema in the configured test database
 * via Doctrine's SchemaTool, and exposes a configured KernelBrowser. The
 * client has reboots disabled so the underlying connection survives across
 * requests in the same test.
 */
abstract class ApiTestCase extends WebTestCase
{
	protected KernelBrowser $client;
	protected EntityManagerInterface $em;

	protected function setUp(): void
	{
		parent::setUp();

		$this->client = self::createClient();
		$this->client->disableReboot();

		/** @var EntityManagerInterface $em */
		$em = self::getContainer()->get('doctrine.orm.entity_manager');
		$this->em = $em;

		$metadata = $em->getMetadataFactory()->getAllMetadata();
		$schemaTool = new SchemaTool($em);
		// Drop first so the suite is resilient on a persistent test database
		// (Postgres). Harmless on an empty schema.
		$schemaTool->dropSchema($metadata);
		$schemaTool->createSchema($metadata);

		// Cache pool is filesystem-backed in tests so it survives across the
		// in-process requests a single test issues; clear it between tests.
		$this->cache()->clear();
	}

	protected function tearDown(): void
	{
		// Tear the schema back down so each test sees a clean database.
		$metadata = $this->em->getMetadataFactory()->getAllMetadata();
		(new SchemaTool($this->em))->dropSchema($metadata);

		$this->em->getConnection()->close();
		$this->cache()->clear();

		parent::tearDown();
	}

	private function cache(): CacheItemPoolInterface
	{
		/** @var CacheItemPoolInterface $cache */
		$cache = self::getContainer()->get('cache.app');

		return $cache;
	}

	/**
	 * @param array<string, mixed> $body
	 *
	 * @return array<string, mixed>|null
	 */
	protected function request(string $method, string $path, ?array $body = null): ?array
	{
		$this->client->request(
			$method,
			$path,
			server: ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'],
			content: null === $body ? null : json_encode($body, JSON_THROW_ON_ERROR),
		);

		$response = $this->client->getResponse();
		$content = $response->getContent();

		if (false === $content || '' === $content) {
			return null;
		}

		/** @var array<string, mixed>|null $decoded */
		$decoded = json_decode($content, true);

		return is_array($decoded) ? $decoded : null;
	}

	protected function lastStatus(): int
	{
		return $this->client->getResponse()->getStatusCode();
	}

	protected function assertStatus(int $expected): void
	{
		$actual = $this->lastStatus();
		if ($expected === $actual) {
			$this->assertSame($expected, $actual);

			return;
		}

		$body = $this->client->getResponse()->getContent();
		$this->fail(sprintf(
			'Expected HTTP %d, got %d. Body: %s',
			$expected,
			$actual,
			false === $body ? '<no body>' : $body,
		));
	}

	protected function assertStatusOk(): void
	{
		$this->assertStatus(Response::HTTP_OK);
	}
}
