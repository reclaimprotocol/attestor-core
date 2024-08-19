FROM node:lts

# install git
RUN apt update -y && apt upgrade -y && apt install git -y

ARG GL_TOKEN
RUN git config --global url."https://git-push-pull:${GL_TOKEN}@gitlab.reclaimprotocol.org".insteadOf "https://gitlab.reclaimprotocol.org"

COPY ./package.json /witness/
COPY ./package-lock.json /witness/
COPY ./tsconfig.json /witness/

# install our witness node
WORKDIR /witness

RUN npm i

COPY ./ /witness

RUN npm run build
RUN npm run build:browser
RUN npm prune --production

CMD ["npm", "run", "start"]
EXPOSE 8001