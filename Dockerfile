FROM node:16-alpine as installer
WORKDIR /usr/app
COPY package.json ./
COPY yarn.lock ./
RUN yarn install --frozen-lockfile

FROM node:16-alpine as runner
LABEL org.opencontainers.image.source="https://github.com/devterm-its/semantic-pull-requests"
WORKDIR /usr/app
COPY --from=installer /usr/app/package.json ./
COPY --from=installer /usr/app/yarn.lock ./
COPY --from=installer /usr/app/node_modules ./node_modules
COPY lib ./
COPY index.js ./
USER node
CMD [ "yarn", "start" ]
